// The panel's three sections, stacked. Each has a title bar that stays put, and under it a body that
// scrolls on its own. The line between two open sections drags to move the border it marks, as the
// sashes between VS Code's panes do: one section grows by what the other gives up. A folded section
// is as tall as what it still shows.

import { useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { PanResponder, View } from "react-native";
import type { LayoutChangeEvent, ViewStyle } from "react-native";
import { z } from "zod";
import { Heading, useHost } from "./ui";

/** The upper two sections' shares of the panel's height. null: as tall as the content, up to a cap. The graph takes the rest. */
export const sizesSchema = z.object({ repositories: z.number().nullable(), changes: z.number().nullable() });
export type Sizes = z.infer<typeof sizesSchema>;

const CAP = { repositories: "25%", changes: "40%" } as const;
const LEAST = 48; // the height a section keeps when its neighbour is dragged over it
const TITLE: ViewStyle = { flexGrow: 0, flexShrink: 0 }; // a folded section: as tall as what is left of it
const REST: ViewStyle = { flex: 1, minHeight: 0 }; // the section that takes the room the others leave

export interface Section {
  title: string;
  count?: number; // how many things it holds, shown in the title bar
  folded: boolean;
  onFold: () => void;
  actions?: ReactNode; // in the title bar while the section is open
  body: ReactNode; // what shows under the title bar, scrolling on its own
}

interface Props {
  sizes: Sizes;
  onSizes: (sizes: Sizes) => void; // once, when a drag ends
  repositories: Section;
  changes: Section;
  graph: Section;
}

export function Split({ sizes, onSizes, repositories, changes, graph }: Props) {
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
  // The last open section takes the room the others leave.
  const rest = [graph, changes, repositories].find((section) => !section.folded);
  const changesTakeRest = rest === changes;
  const within = (move: number, least: number, most: number) => Math.min(Math.max(move, least), most);
  const moveUpper = (dy: number) => {
    const { all, repositories, changes } = held.current;
    const move = within(dy, LEAST - repositories, changes - LEAST);
    // When the changes take what is left, they have no share of their own to give up.
    setNow((sizes) => ({ repositories: (repositories + move) / all, changes: changesTakeRest ? sizes.changes : (changes - move) / all }));
  };
  const moveLower = (dy: number) => {
    const { all, changes, graph } = held.current;
    const move = within(dy, LEAST - changes, graph - LEAST);
    setNow((sizes) => ({ ...sizes, changes: (changes + move) / all }));
  };
  const end = () => onSizes(latest.current);
  /** A section's height. One with a share of null is as tall as its content, up to `cap`. */
  const height = (section: Section, share: number | null, cap: `${number}%`): ViewStyle =>
    section.folded ? TITLE : section === rest ? REST : share === null ? { flexGrow: 0, maxHeight: cap } : { flexGrow: 0, flexShrink: 0, height: `${share * 100}%` };
  return (
    <View style={{ flex: 1 }} onLayout={measure("all")}>
      <Part section={repositories} style={height(repositories, now.repositories, CAP.repositories)} onLayout={measure("repositories")} />
      <Divider label="Resize Repositories" fixed={repositories.folded || changes.folded} onStart={begin} onDrag={moveUpper} onEnd={end} />
      <Part section={changes} style={height(changes, now.changes, CAP.changes)} onLayout={measure("changes")} />
      <Divider label="Resize Changes" fixed={changes.folded || graph.folded} onStart={begin} onDrag={moveLower} onEnd={end} />
      <Part section={graph} style={graph.folded ? TITLE : REST} onLayout={measure("graph")} />
    </View>
  );
}

/** A section: its title bar, which folds it, and its body. A folded section keeps its actions to itself, as in VS Code. */
function Part({ section, style, onLayout }: { section: Section; style: ViewStyle; onLayout: (event: LayoutChangeEvent) => void }) {
  return (
    <View style={style} onLayout={onLayout}>
      <Heading title={section.title} folded={section.folded} onFold={section.onFold} count={section.count}>
        {!section.folded && section.actions}
      </Heading>
      {section.body}
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
