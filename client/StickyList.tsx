// A scrolling list whose rows that hold others stay at its top while what they hold scrolls under them.
//
// The kept rows are drawn in a box that the ScrollView itself holds at its top (`stickyHeaderIndices`), so it stays put
// without waiting on the scroll events, and the wheel and a finger dragged over it still scroll the list. Which rows the
// box shows follows the scroll position.

import { Fragment, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { held } from "./sticky";
import type { Row } from "./sticky";
import { useHost } from "./ui";

/** `head` scrolls away above the rows; every row is `row` tall. */
export function StickyList({ head, rows }: { head: ReactNode; rows: Row[] }) {
  const { c, row } = useHost();
  const list = useRef<ScrollView>(null);
  const [scrolled, setScrolled] = useState(0);
  const [headHeight, setHeadHeight] = useState(0);
  const body = useMemo(() => rows.map((item) => <Fragment key={item.key}>{item.render(item.onPress)}</Fragment>), [rows]);
  const kept = held(rows, scrolled - headHeight, row);
  const height = Math.max(0, ...kept.map(({ top }) => top + row));
  return (
    <ScrollView ref={list} stickyHeaderIndices={[0]} scrollEventThrottle={16} onScroll={(event) => setScrolled(event.nativeEvent.contentOffset.y)} keyboardShouldPersistTaps="handled">
      <View style={{ height }}>
        {/* The deepest first, so that a row pushed up slides under the one above it. */}
        {[...kept].reverse().map(({ index, top }) => {
          const item = rows[index];
          // Pressed here, a row first scrolls the list back to where it is drawn, so that folding it leaves it in place.
          const press = () => {
            list.current?.scrollTo({ y: headHeight + (index - item.depth) * row, animated: false });
            item.onPress();
          };
          return (
            <View key={item.key} style={{ position: "absolute", top, left: 0, right: 0, backgroundColor: c.surface0 }}>
              {item.render(press)}
            </View>
          );
        })}
      </View>
      {/* Pulled up under the box, which takes no room of its own. */}
      <View style={{ marginTop: -height }} onLayout={(event) => setHeadHeight(event.nativeEvent.layout.height)}>
        {head}
      </View>
      {body}
    </ScrollView>
  );
}
