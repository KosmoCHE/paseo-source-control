// The panel's three sections, stacked. The line between two of them drags to move the border
// it marks, as the sashes between VS Code's panes do: one section grows by what the other gives up.
// A folded section is as tall as its title bar, and the line beside it does not drag.

import { useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { PanResponder, ScrollView, View } from "react-native";
import type { LayoutChangeEvent, ViewStyle } from "react-native";
import { z } from "zod";
import { useHost } from "./ui";

/** The upper two sections' shares of the panel's height. null: as tall as the content, up to a cap. The graph takes the rest. */
export const sizesSchema = z.object({ repositories: z.number().nullable(), changes: z.number().nullable() });
export type Sizes = z.infer<typeof sizesSchema>;

const CAP = { repositories: "25%", changes: "40%" } as const;
const LEAST = 48; // the height a section keeps when its neighbour is dragged over it
const TITLE: ViewStyle = { flexGrow: 0, flexShrink: 0 }; // a folded section: as tall as what is left of it
const REST: ViewStyle = { flex: 1, minHeight: 0 }; // the section that takes the room the others leave

interface Props {
  sizes: Sizes;
  onSizes: (sizes: Sizes) => void; // once, when a drag ends
  repositories: ReactNode;
  changes: ReactNode;
  graph: ReactNode;
  folded: { repositories: boolean; graph: boolean }; // with the graph folded, the changes take the room it leaves
}

export function Split({ sizes, onSizes, repositories, folded, changes, graph }: Props) {
  const [now, setNow] = useState(sizes); // followed while a line is dragged, saved when it is let go
  const latest = useRef(now);
  latest.current = now;
  const heights = useRef({ all: 0, repositories: 0, changes: 0, graph: 0 });
  const held = useRef(heights.current); // the heights when the drag began
  const measure = (part: keyof typeof heights.current) => (event: LayoutChangeEvent) => {
    heights.current[part] = event.nativeEvent.layout.height;
  };
  const begin = () => {
    held.current = { ...heights.current };
  };
  const within = (move: number, least: number, most: number) => Math.min(Math.max(move, least), most);
  const moveUpper = (dy: number) => {
    const { all, repositories, changes } = held.current;
    const move = within(dy, LEAST - repositories, changes - LEAST);
    // With the graph folded the changes have no share of their own to give up: they take what is left.
    setNow((sizes) => ({ repositories: (repositories + move) / all, changes: folded.graph ? sizes.changes : (changes - move) / all }));
  };
  const moveLower = (dy: number) => {
    const { all, changes, graph } = held.current;
    const move = within(dy, LEAST - changes, graph - LEAST);
    setNow((sizes) => ({ ...sizes, changes: (changes + move) / all }));
  };
  const end = () => onSizes(latest.current);
  const pane = (share: number | null, cap: `${number}%`): ViewStyle => (share === null ? { flexGrow: 0, maxHeight: cap } : { flexGrow: 0, flexShrink: 0, height: `${share * 100}%` });
  return (
    <View style={{ flex: 1 }} onLayout={measure("all")}>
      <ScrollView style={folded.repositories ? TITLE : pane(now.repositories, CAP.repositories)} onLayout={measure("repositories")}>
        {repositories}
      </ScrollView>
      <Divider label="Resize Repositories" fixed={folded.repositories} onStart={begin} onDrag={moveUpper} onEnd={end} />
      <ScrollView style={folded.graph ? REST : pane(now.changes, CAP.changes)} keyboardShouldPersistTaps="handled" onLayout={measure("changes")}>
        {changes}
      </ScrollView>
      <Divider label="Resize Changes" fixed={folded.graph} onStart={begin} onDrag={moveLower} onEnd={end} />
      <View style={folded.graph ? TITLE : REST} onLayout={measure("graph")}>
        {graph}
      </View>
    </View>
  );
}

interface DividerProps {
  label: string;
  fixed?: boolean;
  onStart: () => void;
  onDrag: (dy: number) => void; // how far the pointer is from where the drag began
  onEnd: () => void;
}

/** One line of the layout, with a taller strip around it to take hold of. */
function Divider({ label, fixed, onStart, onDrag, onEnd }: DividerProps) {
  const { c, compact, platform } = useHost();
  const [dragging, setDragging] = useState(false);
  const act = useRef({ onStart, onDrag, onEnd });
  act.current = { onStart, onDrag, onEnd };
  const responder = useMemo(() => {
    const stop = () => {
      setDragging(false);
      act.current.onEnd();
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        setDragging(true);
        act.current.onStart();
      },
      onPanResponderMove: (_, gesture) => act.current.onDrag(gesture.dy),
      onPanResponderRelease: stop,
      onPanResponderTerminate: stop,
    });
  }, []);
  if (fixed) return <View style={{ height: 1, backgroundColor: c.border }} />;
  const reach = compact ? 10 : 4; // how far the strip reaches over each neighbour: more where a finger takes hold of it
  // In a browser the strip shows the resize cursor and does not start a text selection. React Native's
  // own types know neither value, as neither exists natively.
  const pointer = platform === "web" ? ({ cursor: "row-resize", userSelect: "none" } as object as ViewStyle) : null;
  return (
    <View {...responder.panHandlers} accessibilityLabel={label} style={[{ height: 2 * reach + 1, marginVertical: -reach, zIndex: 1, justifyContent: "center" }, pointer]}>
      <View style={{ height: dragging ? 2 : 1, backgroundColor: dragging ? c.accent : c.border }} />
    </View>
  );
}
