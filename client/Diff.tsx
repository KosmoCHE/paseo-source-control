// The diff tab: one file before and after, as VS Code's diff editor shows it. Lines removed and added are coloured,
// and within them the words that changed; the two versions face each other where the tab is wide enough.

import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Loading } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { FlatList, Text, View } from "react-native";
import { diffRpc } from "../shared/git";
import type { DiffSource, FileChange, FileDiff } from "../shared/git";
import { inlineRows, pairRows } from "./diffRows";
import type { Cell, InlineRow, Marks, PairRow } from "./diffRows";
import { useDiffRequest } from "./diffTab";
import type { DiffRequest } from "./diffTab";
import { key } from "./git";
import { fileName } from "./tree";
import { HostProvider, isDark, Notice, T, useHost } from "./ui";

export function DiffPanel({ theme, layout, workspaceId }: PluginWorkspacePanelProps) {
  const request = useDiffRequest(workspaceId);
  const host = useMemo(() => ({ theme, layout }), [theme, layout]);
  return (
    <HostProvider value={host}>
      <View style={{ flex: 1, backgroundColor: theme.colors.surface0 }}>{request ? <Diff request={request} /> : <Notice>Choose a file in Source Control to see its diff.</Notice>}</View>
    </HostProvider>
  );
}

/** VS Code's widths: below this the diff is drawn inline (diffEditor.renderSideBySideInlineBreakpoint). */
const SIDE_BY_SIDE = 900;

function Diff({ request }: { request: DiffRequest }) {
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
      </View>
      {result.error ? (
        <Notice failed>{result.error.message}</Notice>
      ) : !result.data || !width ? (
        <Loading />
      ) : result.data.kind === "binary" ? (
        <Notice>The file is not displayed in the text editor because it is either binary or uses an unsupported text encoding.</Notice>
      ) : (
        <Lines key={JSON.stringify(request)} found={result.data} sideBySide={width >= SIDE_BY_SIDE} />
      )}
    </View>
  );
}

/** VS Code's default diff colours: the theme has none of its own. Changed text is drawn over its line's colour. */
function useColours() {
  const { c } = useHost();
  const dark = isDark(c.surface0);
  return {
    insertedLine: "rgba(155, 185, 85, 0.2)",
    removedLine: "rgba(255, 0, 0, 0.2)",
    insertedText: dark ? "#9ccc2c33" : "#9ccc2c40",
    removedText: "#ff000033",
    filler: dark ? "#cccccc33" : "#22222233", // diffEditor.diagonalFill, where one side has no line
  };
}

type Shown = Exclude<FileDiff, { kind: "binary" }>;
type Item = { file: string; number: number } | InlineRow | PairRow;

/** The lines, scrolled at first to the first change, as VS Code reveals it. */
function Lines({ found, sideBySide }: { found: Shown; sideBySide: boolean }) {
  const { small } = useHost();
  const list = useRef<FlatList<Item>>(null);
  const items: Item[] = useMemo(() => (found.kind === "file" ? found.lines.map((line, n) => ({ file: line, number: n + 1 })) : sideBySide ? pairRows(found) : inlineRows(found)), [found, sideBySide]);
  const first = items.findIndex((item) => ("kind" in item ? item.kind !== "same" : "changed" in item && item.changed));
  const lines = found.kind === "file" ? found.lines.length : Math.max(found.original.length, found.modified.length);
  const digits = (small + 1) * 0.6 * String(lines).length + 12; // a column wide enough for the last line's number
  // Once, when the diff first shows: it is read again every few seconds, and the reader may have scrolled since.
  useEffect(() => {
    if (first > 0) list.current?.scrollToIndex({ index: Math.max(0, first - 3), animated: false });
  }, []);
  return (
    <>
      {found.kind === "diff" && found.hitTimeout && <Notice>The diff stopped after five seconds, as VS Code's does: more may be marked as changed than was.</Notice>}
      <FlatList
        ref={list}
        style={{ flex: 1 }}
        data={items}
        keyExtractor={(_, n) => String(n)}
        initialNumToRender={60}
        // Rows wrap, so their heights are only known once drawn: scroll near, then again once it is drawn.
        onScrollToIndexFailed={({ index, averageItemLength }) => {
          list.current?.scrollToOffset({ offset: index * averageItemLength, animated: false });
          setTimeout(() => list.current?.scrollToIndex({ index, animated: false }), 50);
        }}
        renderItem={({ item }) =>
          "file" in item ? <FileLine number={item.number} text={item.file} width={digits} /> : "kind" in item ? <InlineLine row={item} width={digits} /> : <PairLine row={item} width={digits} />
        }
      />
    </>
  );
}

/** A line's text, its changed stretches drawn in `colour`. */
function Marked({ text, marks, colour }: { text: string; marks: Marks; colour: string }) {
  const { small } = useHost();
  const parts: ReactNode[] = [];
  let at = 0;
  for (const [start, end] of marks) {
    if (start > at) parts.push(text.slice(at, start));
    parts.push(
      <Text key={start} style={{ backgroundColor: colour }}>
        {text.slice(start, end)}
      </Text>,
    );
    at = end;
  }
  if (at < text.length) parts.push(text.slice(at));
  return (
    <T mono size={small + 1} selectable style={{ flex: 1, minWidth: 0 }}>
      {parts.length ? parts : " "}
    </T>
  );
}

function LineNumber({ value, width }: { value: number | null; width: number }) {
  const { c, small } = useHost();
  return (
    <T mono size={small + 1} color={c.foregroundMuted} style={{ width, paddingRight: 8, textAlign: "right" }}>
      {value === null ? "" : String(value)}
    </T>
  );
}

/** VS Code's + and − beside a changed line (diffEditor.renderIndicators). */
function Indicator({ kind }: { kind: "same" | "remove" | "add" }) {
  const { c, small } = useHost();
  return (
    <T mono size={small + 1} color={c.foregroundMuted} style={{ width: 16 }}>
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

/** A line of the inline view, numbered in the original and in the modified version, as VS Code numbers them. */
function InlineLine({ row, width }: { row: InlineRow; width: number }) {
  const colours = useColours();
  const removed = row.kind === "remove";
  return (
    <View style={{ flexDirection: "row", backgroundColor: row.kind === "add" ? colours.insertedLine : removed ? colours.removedLine : undefined }}>
      <LineNumber value={row.original} width={width} />
      <LineNumber value={row.modified} width={width} />
      <Indicator kind={row.kind} />
      <Marked text={row.text} marks={row.marks} colour={removed ? colours.removedText : colours.insertedText} />
    </View>
  );
}

/** A row of the side-by-side view: the original on the left, the modified on the right. */
function PairLine({ row, width }: { row: PairRow; width: number }) {
  const { c } = useHost();
  const colours = useColours();
  const half = (cell: Cell | null, kind: "remove" | "add") =>
    cell === null ? (
      <View style={{ flex: 1, backgroundColor: colours.filler }} />
    ) : (
      <View style={{ flex: 1, flexDirection: "row", backgroundColor: row.changed ? (kind === "add" ? colours.insertedLine : colours.removedLine) : undefined }}>
        <LineNumber value={cell.number} width={width} />
        <Indicator kind={row.changed ? kind : "same"} />
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
