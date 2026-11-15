// The diff tab: one file before and after, as VS Code's diff editor shows it. Lines removed and added are coloured,
// and within them the words that changed; the two versions face each other where the tab is wide enough.

import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Loading } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { FlatList, PanResponder, Pressable, Text, View } from "react-native";
import type { CellRendererProps, PressableStateCallbackType, ViewStyle } from "react-native";
import { diffRpc } from "../shared/git";
import type { DiffSource, FileChange, FileDiff } from "../shared/git";
import * as codicon from "./codicons";
import { inlineRows, pairRows } from "./diffRows";
import type { Cell, InlineRow, Marks, PairRow } from "./diffRows";
import { useDiffRequest } from "./diffTab";
import type { DiffRequest } from "./diffTab";
import { key } from "./git";
import { changeSpans } from "./overview";
import { OverviewRuler } from "./OverviewRuler";
import type { Measures } from "./OverviewRuler";
import { fileName } from "./tree";
import { HostProvider, IconButton, isDark, Notice, PanelRoot, T, useHint, useHost } from "./ui";
import { dragged, fold, folded, regions, reveal } from "./unchanged";
import type { Hidden, Region, Revealed, Shown } from "./unchanged";

export function DiffPanel({ theme, layout, workspaceId, tab }: PluginWorkspacePanelProps) {
  const request = useDiffRequest(workspaceId);
  const host = useMemo(() => ({ theme, layout }), [theme, layout]);
  // VS Code keeps "Collapse Unchanged Regions" as a setting; the tab keeps it here, off at first as VS Code has it.
  const [collapse, setCollapse] = useState(() => (tab.state as { collapse?: unknown } | null | undefined)?.collapse === true);
  const toggle = () => {
    setCollapse(!collapse);
    tab.setState({ collapse: !collapse });
  };
  return (
    <HostProvider value={host}>
      <PanelRoot>{request ? <Diff request={request} collapse={collapse} onCollapse={toggle} /> : <Notice>Choose a file in Source Control to see its diff.</Notice>}</PanelRoot>
    </HostProvider>
  );
}

/** VS Code's widths: below this the diff is drawn inline (diffEditor.renderSideBySideInlineBreakpoint). */
const SIDE_BY_SIDE = 900;

function Diff({ request, collapse, onCollapse }: { request: DiffRequest; collapse: boolean; onCollapse: () => void }) {
  const { cwd, source, file } = request;
  const { c, small } = useHost();
  const read = useRpc(diffRpc);
  const fixed = source.kind !== "staged" && source.kind !== "changes"; // commits never change; the working tree keeps changing
  const result = useQuery({
    queryKey: key("diff", cwd, source, file),
    queryFn: () => read({ cwd, source, file }),
    staleTime: fixed ? Infinity : 0,
    refetchInterval: fixed ? false : 3000,
  });
  const [width, setWidth] = useState(0);
  return (
    <View style={{ flex: 1 }} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderColor: c.border }}>
        <T weight="600" lines={1} style={{ flexShrink: 1, minWidth: 0 }}>
          {`${fileName(file)} (${compared(source, file)})`}
        </T>
        <T size={small} color={c.foregroundMuted} lines={1} style={{ flexShrink: 1000, minWidth: 0 }}>
          {file.from ? `${file.from} → ${file.path}` : file.path}
        </T>
        {result.data?.kind === "diff" && (
          <View style={{ marginLeft: "auto" }}>
            <IconButton icon={codicon.map} label="Toggle Collapse Unchanged Regions" toggled={collapse} onPress={onCollapse} />
          </View>
        )}
      </View>
      {result.error ? (
        <Notice failed>{result.error.message}</Notice>
      ) : !result.data || !width ? (
        <Loading />
      ) : result.data.kind === "binary" ? (
        <Notice>The file is not displayed in the text editor because it is either binary or uses an unsupported text encoding.</Notice>
      ) : (
        <Lines key={JSON.stringify(request)} found={result.data} sideBySide={width >= SIDE_BY_SIDE} collapse={collapse} />
      )}
    </View>
  );
}

/**
 * The diff colours of VS Code 1.142's default themes, Dark 2026 and Light 2026: the host's theme has none of its own.
 * Light 2026 sets only the colours of changed text; its lines take the colours VS Code registers. Changed text is drawn
 * over its line's colour. Lines shown from a folded region are tinted (diffEditor.unchangedCodeBackground), and a folded
 * region is shaded at its edges (diffEditor.unchangedRegionShadow). The overview ruler marks changes in the colours of
 * changed text twice as opaque (overviewRulerFeature.ts), over a faint background (style.css: .diffOverview), under a
 * slider in the scrollbar's colours.
 */
function useColours() {
  const { c } = useHost();
  return isDark(c.surface0)
    ? {
        insertedLine: "#347d3926",
        insertedText: "#57ab5a4d",
        removedLine: "#c93c3726",
        removedText: "#f470674d",
        filler: "#cccccc33",
        unchanged: "#74747429",
        shadow: "#000000",
        ruler: {
          background: "rgba(255, 255, 255, 0.01)",
          removed: "rgba(244, 112, 103, 0.604)",
          added: "rgba(87, 171, 90, 0.604)",
          slider: ["#A8A9AA85", "#A8A9AA90", "#A8A9AA9C"] as [string, string, string],
        },
      }
    : {
        insertedLine: "rgba(155, 185, 85, 0.2)",
        insertedText: "#587c0c26",
        removedLine: "rgba(255, 0, 0, 0.2)",
        removedText: "#ad070726",
        filler: "#22222233",
        unchanged: "#b8b8b829",
        shadow: "#737373BF",
        ruler: { background: "rgba(0, 0, 0, 0.03)", removed: "rgba(173, 7, 7, 0.298)", added: "rgba(88, 124, 12, 0.298)", slider: ["#646464C0", "#646464D0", "#646464E0"] as [string, string, string] },
      };
}

type Found = Exclude<FileDiff, { kind: "binary" }>;
type Row = InlineRow | PairRow;
type Item = { file: string; number: number } | Row | Revealed<Row> | Hidden;

/** The modified version's line of a row the same in both versions; null for a changed one. */
const sameLine = (row: Row) => ("kind" in row ? (row.kind === "same" ? row.modified : null) : row.changed ? null : row.right!.number);
const removedRow = (item: Item) => ("kind" in item ? item.kind === "remove" : "changed" in item && item.changed && item.left !== null);
const addedRow = (item: Item) => ("kind" in item ? item.kind === "add" : "changed" in item && item.changed && item.right !== null);
const keyOf = (item: Item) =>
  "file" in item ? `f${item.number}` : "hidden" in item ? `h${item.hidden}` : "kind" in item ? `${item.kind}${item.original}:${item.modified}` : `${item.left?.number}:${item.right?.number}`;
const regionKey = ({ original, modified, length }: Region) => `${original}:${modified}:${length}`;

/** The lines, scrolled at first to the first change; unchanged ones folded while `collapse` is on; the overview ruler beside them. */
function Lines({ found, sideBySide, collapse }: { found: Found; sideBySide: boolean; collapse: boolean }) {
  const { code, compact } = useHost();
  const colours = useColours();
  const list = useRef<FlatList<Item>>(null);
  const rows: Item[] = useMemo(() => (found.kind === "file" ? found.lines.map((line, n) => ({ file: line, number: n + 1 })) : sideBySide ? pairRows(found) : inlineRows(found)), [found, sideBySide]);
  const unchanged = useMemo(() => (found.kind === "diff" ? regions(found.changes, found.original.length, found.modified.length) : []), [found]);
  // How much of each region shows, by where it is. Turning the switch on folds them all again, as in VS Code.
  const [opened, setOpened] = useState(new Map<string, Shown>());
  useEffect(() => setOpened(new Map()), [collapse]);
  const items: Item[] = useMemo(
    () =>
      collapse && found.kind === "diff"
        ? fold(
            rows as Row[],
            sameLine,
            unchanged,
            unchanged.map((region) => opened.get(regionKey(region)) ?? folded),
          )
        : rows,
    [rows, collapse, found.kind, unchanged, opened],
  );
  // A region's bottom edge brings lines back under its bar with the lines after the region kept in place, as VS Code's
  // does (_runWithLowerScrollAnchor): what is above moves up instead. `below` is how many showed there before.
  const anchor = useRef<{ region: Region; below: number } | null>(null);
  const open = (index: number, change: (region: Region, shown: Shown) => Shown, anchored = false) => {
    const region = unchanged[index];
    if (anchored) anchor.current ??= { region, below: (opened.get(regionKey(region)) ?? folded).bottom };
    setOpened((before) => {
      const was = before.get(regionKey(region)) ?? folded;
      const next = change(region, was);
      return next.top === was.top && next.bottom === was.bottom ? before : new Map(before).set(regionKey(region), next);
    });
  };
  const first = items.findIndex((item) => ("kind" in item ? item.kind !== "same" : "changed" in item && item.changed));
  const lines = found.kind === "file" ? found.lines.length : Math.max(found.original.length, found.modified.length);
  const digits = code.fontSize * 0.6 * String(lines).length + 12; // a column wide enough for the last line's number
  // Once, when the diff first shows: it is read again every few seconds, and the reader may have scrolled since.
  useEffect(() => {
    if (first > 0) list.current?.scrollToIndex({ index: Math.max(0, first - 3), animated: false });
  }, []);

  // VS Code draws the ruler beside every diff; a phone has no room for it.
  const ruler = found.kind === "diff" && !compact;
  const measures = useRef<Measures>({ heights: new Map(), view: 0, content: 0, scrolled: 0 }).current;
  useEffect(() => measures.heights.clear(), [sideBySide]); // rows of the other layout would skew the average
  const keys = useMemo(() => items.map(keyOf), [items]);
  const spans = useMemo(() => changeSpans(items, removedRow, addedRow), [items]);
  const scrollTo = useCallback((offset: number) => list.current?.scrollToOffset({ offset: Math.max(0, Math.min(offset, measures.content - measures.view)), animated: false }), [measures]);
  const scrollBy = (delta: number) => {
    measures.scrolled += delta; // at once: the next move may come before the scroll is told
    list.current?.scrollToOffset({ offset: measures.scrolled, animated: false });
  };

  // How tall a region's line is drawn, under keyOf's key for a row the same in both versions; undefined until it is.
  const lineKey = (region: Region, line: number) => `${sideBySide ? "" : "same"}${region.original + line}:${region.modified + line}`;
  const lineHeight = (region: Region) => (line: number) => measures.heights.get(lineKey(region, line)) ?? code.lineHeight;
  // Lines brought back under a bar scroll the diff by their height once drawn; until then, by one line each.
  const guessed = useRef(new Map<string, number>()).current;
  useLayoutEffect(() => {
    if (!anchor.current) return;
    const { region, below } = anchor.current;
    anchor.current = null;
    guessed.clear();
    const now = (opened.get(regionKey(region)) ?? folded).bottom;
    let delta = 0;
    for (let n = Math.min(below, now); n < Math.max(below, now); n++) {
      const line = region.length - 1 - n;
      if (!measures.heights.has(lineKey(region, line))) guessed.set(lineKey(region, line), code.lineHeight);
      delta += lineHeight(region)(line);
    }
    scrollBy(now > below ? delta : -delta);
  }, [opened]);
  const measure = (item: Item, height: number) => {
    measures.heights.set(keyOf(item), height);
    const guess = guessed.get(keyOf(item));
    if (guess !== undefined && guessed.delete(keyOf(item))) scrollBy(height - guess);
    measures.changed?.();
  };
  const draw = (item: Item) => {
    if ("file" in item) return <FileLine number={item.number} text={item.file} width={digits} />;
    if ("hidden" in item) {
      const region = unchanged[item.hidden];
      const shown = opened.get(regionKey(region)) ?? folded;
      return (
        <HiddenLines
          lines={item.lines}
          region={region}
          shown={shown}
          height={lineHeight(region)}
          gutter={sideBySide ? digits + 16 : digits * 2 + 16}
          halves={sideBySide ? 2 : 1}
          open={(change, anchored) => open(item.hidden, change, anchored)}
        />
      );
    }
    const revealed = "region" in item;
    const onFold = revealed && item.first ? () => open(item.region, () => folded) : undefined;
    return "kind" in item ? <InlineLine row={item} width={digits} revealed={revealed} onFold={onFold} /> : <PairLine row={item} width={digits} revealed={revealed} onFold={onFold} />;
  };
  return (
    <>
      {found.kind === "diff" && found.hitTimeout && <Notice>The diff stopped after five seconds, as VS Code's does: more may be marked as changed than was.</Notice>}
      <View style={{ flex: 1, flexDirection: "row" }}>
        <FlatList
          ref={list}
          style={{ flex: 1 }}
          data={items}
          keyExtractor={keyOf}
          initialNumToRender={60}
          // Rows wrap, so their heights are only known once drawn: scroll near, then again once it is drawn.
          onScrollToIndexFailed={({ index, averageItemLength }) => {
            list.current?.scrollToOffset({ offset: index * averageItemLength, animated: false });
            setTimeout(() => list.current?.scrollToIndex({ index, animated: false }), 50);
          }}
          onLayout={(event) => {
            measures.view = event.nativeEvent.layout.height;
            measures.changed?.();
          }}
          onContentSizeChange={(_, height) => {
            measures.content = height;
            measures.changed?.();
          }}
          scrollEventThrottle={16}
          onScroll={(event) => {
            measures.scrolled = event.nativeEvent.contentOffset.y;
            measures.changed?.();
          }}
          CellRendererComponent={Cell}
          renderItem={({ item }) => <View onLayout={(event) => measure(item, event.nativeEvent.layout.height)}>{draw(item)}</View>}
        />
        {ruler && <OverviewRuler keys={keys} spans={spans} measures={measures} colours={colours.ruler} scrollTo={scrollTo} />}
      </View>
    </>
  );
}

/** A row of the list; a folded region's is drawn over the row below, which the region's bottom edge reaches into. */
function Cell({ item, style, ...props }: CellRendererProps<Item>) {
  return <View {...props} style={[style, "hidden" in item && { zIndex: 1 }]} />;
}

/**
 * A folded region, drawn as VS Code draws it across each version: an icon that opens it all, how many lines it hides,
 * which a double click also opens, and edges that, clicked, bring back 20 lines next to them, or, dragged, as many as
 * the pointer passes (hideUnchangedRegionsFeature.ts: CollapsedCodeOverlayWidget).
 */
function HiddenLines({
  lines,
  region,
  shown,
  height,
  gutter,
  halves,
  open,
}: {
  lines: number;
  region: Region;
  shown: Shown;
  height: (line: number) => number;
  gutter: number;
  halves: number;
  open: (change: (region: Region, shown: Shown) => Shown, anchored?: boolean) => void;
}) {
  const { c } = useHost();
  const colours = useColours();
  const all = () => open(reveal.all);
  const bar = (half: number) => (
    <View
      key={half}
      style={
        {
          flex: 1,
          height: 24,
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: c.surface1,
          boxShadow: `inset 0 -5px 5px -7px ${colours.shadow}, inset 0 5px 5px -7px ${colours.shadow}`,
        } as ViewStyle
      }
    >
      <View style={{ width: gutter, alignItems: "center" }}>
        <BarButton hint="Show Unchanged Region" onPress={all}>
          {(hovered) => (
            // In the link colour under the pointer (style.css). Both colours stay drawn, the one shown changes: an icon
            // drawn again as the pointer comes onto it could be a new element by the time it is pressed.
            <View>
              <Glyph icon={codicon.unfold} size={16} color={c.foreground} />
              <View style={{ position: "absolute", top: 0, left: 0, opacity: hovered ? 1 : 0 }}>
                <Glyph icon={codicon.unfold} size={16} color={c.accent} />
              </View>
            </View>
          )}
        </BarButton>
      </View>
      <DoublePress hint="Double click to unfold" onDouble={all}>
        <T size={13} color={c.foreground} lines={1}>{`${lines} hidden lines`}</T>
      </DoublePress>
      <Edge edge="top" region={region} shown={shown} height={height} open={open} />
      <Edge edge="bottom" region={region} shown={shown} height={height} open={open} />
    </View>
  );
  return (
    <View style={{ flexDirection: "row" }}>
      {bar(0)}
      {halves === 2 && <View style={{ width: 1, backgroundColor: c.border }} />}
      {halves === 2 && bar(1)}
    </View>
  );
}

/**
 * An icon drawn again only when what it shows changes. Inline SVG drawn again is a new element, and a press that ends on
 * another element than it began on is no click: a button whose icon is drawn again as it is pressed would not work.
 */
const Glyph = memo(Icon);

function BarButton({ hint, onPress, children }: { hint: string; onPress: () => void; children: (hovered: boolean) => ReactNode }) {
  return (
    <Pressable {...useHint(hint)} accessibilityRole="button" accessibilityLabel={hint} onPress={onPress}>
      {(state: PressableStateCallbackType) => children(!!(state as { hovered?: boolean }).hovered)}
    </Pressable>
  );
}

/** Text that does something when pressed twice in a row, as VS Code's double click. */
function DoublePress({ hint, onDouble, children }: { hint: string; onDouble: () => void; children: ReactNode }) {
  const last = useRef(0);
  const press = () => {
    const now = Date.now();
    if (now - last.current < 500) onDouble();
    last.current = now;
  };
  return (
    <Pressable {...useHint(hint)} onPress={press} style={{ flexShrink: 1, minWidth: 0 }}>
      {children}
    </Pressable>
  );
}

/**
 * A folded region's top or bottom edge, as VS Code's (style.css): 10 pixels to grab across the bar's border, 6 of them
 * on the side the lines come from, lit 4 pixels across it under the pointer and while dragged, its cursor saying which
 * ways it can go. The top edge brings lines back above the bar, which moves down with the pointer; the bottom edge
 * brings them back below it, and the diff scrolls so that the bar moves up with the pointer.
 */
function Edge({
  edge,
  region,
  shown,
  height,
  open,
}: {
  edge: "top" | "bottom";
  region: Region;
  shown: Shown;
  height: (line: number) => number;
  open: (change: (region: Region, shown: Shown) => Shown, anchored?: boolean) => void;
}) {
  const { c, platform } = useHost();
  const hint = useHint(edge === "top" ? "Click or drag to show more above" : "Click or drag to show more below");
  const [lit, setLit] = useState(false);
  const [dragging, setDragging] = useState(false);
  const live = useRef({ region, shown, height, open });
  live.current = { region, shown, height, open };
  const responder = useMemo(() => {
    let from = 0;
    let moved = false;
    const change = (next: (region: Region, shown: Shown) => Shown) => live.current.open(next, edge === "bottom");
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        hint.onPressIn();
        from = live.current.shown[edge];
        moved = false;
        setDragging(true);
      },
      onPanResponderMove: (_, gesture) => {
        moved ||= Math.abs(gesture.dy) > 2;
        const count = dragged(live.current.region, edge, from, gesture.dy, live.current.height);
        change((region, shown) => reveal.to(region, shown, edge, count));
      },
      onPanResponderRelease: () => {
        setDragging(false);
        if (!moved) change(edge === "top" ? reveal.above : reveal.below);
      },
      onPanResponderTerminate: () => setDragging(false),
    });
  }, [edge]);
  const back = shown[edge] > 0;
  const cursor = edge === "top" ? (back ? "ns-resize" : "s-resize") : back ? "ns-resize" : "n-resize";
  return (
    <View
      ref={hint.ref}
      {...responder.panHandlers}
      {...({ onPointerEnter: () => (setLit(true), hint.onHoverIn()), onPointerLeave: () => (setLit(false), hint.onHoverOut()) } as object)}
      style={[{ position: "absolute", left: 0, right: 0, height: 10 }, edge === "top" ? { top: -6 } : { bottom: -4 }, platform === "web" ? ({ cursor } as object as ViewStyle) : null]}
    >
      <View style={{ marginTop: 4, height: 4, backgroundColor: lit || dragging ? c.accent : undefined }} />
    </View>
  );
}

/**
 * A line's text, its changed stretches drawn in `colour`. VS Code colours a changed stretch the full height of its line
 * (decorations.css: `.cdr` is `height: 100%`); a stretch of text is coloured only as tall as its font, about 1.17 times
 * its size for Menlo, so it is padded out to the line. A stretch names the code font again: once an interface font is
 * set, Paseo gives every element outside its own code views that font (apply-root-font.web.ts), and the stretch would
 * take it instead of the line's.
 */
function Marked({ text, marks, colour }: { text: string; marks: Marks; colour: string }) {
  const { code } = useHost();
  const fill = (code.lineHeight - code.fontSize * 1.17) / 2;
  const parts: ReactNode[] = [];
  let at = 0;
  for (const [start, end] of marks) {
    if (start > at) parts.push(text.slice(at, start));
    parts.push(
      <Text key={start} style={{ fontFamily: code.fontFamily, backgroundColor: colour, paddingVertical: fill }}>
        {text.slice(start, end)}
      </Text>,
    );
    at = end;
  }
  if (at < text.length) parts.push(text.slice(at));
  return (
    <T selectable style={[code, { flex: 1, minWidth: 0 }]}>
      {parts.length ? parts : " "}
    </T>
  );
}

function LineNumber({ value, width }: { value: number | null; width: number }) {
  const { c, code } = useHost();
  return (
    <T color={c.foregroundMuted} style={[code, { width, paddingRight: 8, textAlign: "right" }]}>
      {value === null ? "" : String(value)}
    </T>
  );
}

/**
 * VS Code's + and − beside a changed line (diffEditor.renderIndicators). Beside the first line of a region opened in
 * full, the icon that folds it again, as VS Code puts it in the margin.
 */
function Indicator({ kind, onFold }: { kind: "same" | "remove" | "add"; onFold?: () => void }) {
  const { c, code } = useHost();
  if (onFold)
    return (
      <View style={{ width: 16, height: code.lineHeight, justifyContent: "center" }}>
        <BarButton hint="Fold Unchanged Region" onPress={onFold}>
          {() => <Glyph icon={codicon.fold} size={16} color={c.foregroundMuted} />}
        </BarButton>
      </View>
    );
  return (
    <T color={c.foregroundMuted} style={[code, { width: 16 }]}>
      {kind === "add" ? "+" : kind === "remove" ? "−" : " "}
    </T>
  );
}

function FileLine({ number, text, width }: { number: number; text: string; width: number }) {
  return (
    <View style={{ flexDirection: "row" }}>
      <LineNumber value={number} width={width} />
      <Marked text={text} marks={[]} colour="" />
    </View>
  );
}

interface LineProps {
  width: number;
  revealed: boolean; // shown from a folded region
  onFold?: () => void;
}

/** A line of the inline view, numbered in the original and in the modified version, as VS Code numbers them. */
function InlineLine({ row, width, revealed, onFold }: LineProps & { row: InlineRow }) {
  const colours = useColours();
  const removed = row.kind === "remove";
  return (
    <View style={{ flexDirection: "row", backgroundColor: row.kind === "add" ? colours.insertedLine : removed ? colours.removedLine : revealed ? colours.unchanged : undefined }}>
      <LineNumber value={row.original} width={width} />
      <LineNumber value={row.modified} width={width} />
      <Indicator kind={row.kind} onFold={onFold} />
      <Marked text={row.text} marks={row.marks} colour={removed ? colours.removedText : colours.insertedText} />
    </View>
  );
}

/** A row of the side-by-side view: the original on the left, the modified on the right. */
function PairLine({ row, width, revealed, onFold }: LineProps & { row: PairRow }) {
  const { c } = useHost();
  const colours = useColours();
  const half = (cell: Cell | null, kind: "remove" | "add") =>
    cell === null ? (
      <View style={{ flex: 1, backgroundColor: colours.filler }} />
    ) : (
      <View style={{ flex: 1, flexDirection: "row", backgroundColor: row.changed ? (kind === "add" ? colours.insertedLine : colours.removedLine) : revealed ? colours.unchanged : undefined }}>
        <LineNumber value={cell.number} width={width} />
        <Indicator kind={row.changed ? kind : "same"} onFold={onFold} />
        <Marked text={cell.text} marks={cell.marks} colour={kind === "add" ? colours.insertedText : colours.removedText} />
      </View>
    );
  return (
    <View style={{ flexDirection: "row" }}>
      {half(row.left, "remove")}
      <View style={{ width: 1, backgroundColor: c.border }} />
      {half(row.right, "add")}
    </View>
  );
}

/** What VS Code writes after a file's name in the title of its diff: the version shown, or the commit. */
function compared(source: DiffSource, file: FileChange) {
  if (source.kind === "commit") return source.hash.slice(0, 7);
  if (source.kind === "incoming") return "Incoming Changes";
  if (source.kind === "outgoing") return "Outgoing Changes";
  if (file.status === "D") return "Deleted";
  if (source.kind === "staged") return "Index";
  return file.status === "?" ? "Untracked" : "Working Tree";
}
