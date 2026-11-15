// The overview ruler at the right of the diff: where the file changed, and which part of it is in view. Pressing it
// scrolls there, and dragging moves the part in view, as on VS Code's.

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { PanResponder, Platform, View } from "react-native";
import { slider, WIDTH, zone } from "./overview";
import type { Span } from "./overview";

/** What the list tells the ruler as it is drawn and scrolled. Rows are measured as they are drawn. */
export interface Measures {
  heights: Map<string, number>; // by row key
  view: number;
  content: number;
  scrolled: number;
  changed?: () => void; // the ruler's, to draw itself again
}

export interface RulerColours {
  background: string;
  removed: string;
  added: string;
  slider: [rest: string, hover: string, active: string];
}

// The little of the DOM the wheel needs: the plugin is typed without the DOM's types.
interface WheelEvent {
  deltaY: number;
  preventDefault(): void;
}
interface WheelTarget {
  addEventListener(type: "wheel", listener: (event: WheelEvent) => void, options: { passive: boolean }): void;
  removeEventListener(type: "wheel", listener: (event: WheelEvent) => void): void;
}

interface Props {
  keys: string[]; // the rows' keys, in order
  spans: { removed: Span[]; added: Span[] };
  measures: Measures;
  colours: RulerColours;
  scrollTo: (offset: number) => void;
}

export function OverviewRuler({ keys, spans, measures, colours, scrollTo }: Props) {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    let frame: number | null = null;
    measures.changed = () => {
      if (frame === null) frame = requestAnimationFrame(() => ((frame = null), redraw()));
    };
    return () => {
      measures.changed = undefined;
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [measures]);
  const { view, content, scrolled, heights } = measures;
  const state = slider(view, content, scrolled);

  // Where each row starts: as drawn, or, for rows not drawn yet, the average of those that were.
  let total = 0;
  for (const height of heights.values()) total += height;
  const average = heights.size ? total / heights.size : 0;
  const starts = new Float64Array(keys.length + 1);
  keys.forEach((key, index) => (starts[index + 1] = starts[index] + (heights.get(key) ?? average)));

  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);
  const live = useRef({ state, scrolled });
  live.current = { state, scrolled };
  const responder = useMemo(() => {
    let from = 0;
    const stop = () => setDragging(false);
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      // As on a scrollbar: the slider centres on the press, and then follows the pointer.
      onPanResponderGrant: (event) => {
        const { state } = live.current;
        setDragging(true);
        from = state.ratio > 0 ? (event.nativeEvent.locationY - state.size / 2) / state.ratio : 0;
        scrollTo(from);
      },
      onPanResponderMove: (_, gesture) => {
        const { state } = live.current;
        if (state.ratio > 0) scrollTo(from + gesture.dy / state.ratio);
      },
      onPanResponderRelease: stop,
      onPanResponderTerminate: stop,
    });
  }, [scrollTo]);

  // The wheel over the ruler scrolls the diff, as it does over VS Code's.
  const root = useRef<View>(null);
  useEffect(() => {
    const node = root.current as unknown as WheelTarget | null; // on the web, the element itself
    if (Platform.OS !== "web" || !node) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      scrollTo(live.current.scrolled + event.deltaY);
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, [scrollTo]);

  const marks = (list: Span[], colour: string, left: number) =>
    content > 0 &&
    list.map(([from, to]) => {
      const { top, height } = zone(starts[from], starts[to], Math.max(content, view), view); // a diff shorter than the view is not stretched over it
      return <View key={from} pointerEvents="none" style={{ position: "absolute", left, width: WIDTH / 2, top, height, backgroundColor: colour }} />;
    });
  const over = (y: number) => setHovered(y >= state.top && y < state.top + state.size);
  return (
    <View
      ref={root}
      {...responder.panHandlers}
      {...({ onPointerMove: (event: { nativeEvent: { offsetY: number } }) => over(event.nativeEvent.offsetY), onPointerLeave: () => setHovered(false) } as object)}
      style={{ width: WIDTH, backgroundColor: colours.background }}
    >
      {marks(spans.removed, colours.removed, 0)}
      {marks(spans.added, colours.added, WIDTH / 2)}
      <View pointerEvents="none" style={{ position: "absolute", left: 0, width: WIDTH, top: state.top, height: state.size, backgroundColor: colours.slider[dragging ? 2 : hovered ? 1 : 0] }} />
    </View>
  );
}
