// The diff tab: one file's patch, coloured line by line.

import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Loading } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { FlatList, View } from "react-native";
import { diffRpc } from "../shared/git";
import type { DiffSource, FileChange } from "../shared/git";
import { useDiffRequest } from "./diffTab";
import type { DiffRequest } from "./diffTab";
import { key } from "./git";
import { parsePatch } from "./patch";
import type { Line } from "./patch";
import { fileName } from "./tree";
import { HostProvider, Notice, T, Tint, useHost } from "./ui";

export function DiffPanel({ theme, layout, workspaceId }: PluginWorkspacePanelProps) {
  const request = useDiffRequest(workspaceId);
  const host = useMemo(() => ({ theme, layout }), [theme, layout]);
  return (
    <HostProvider value={host}>
      <View style={{ flex: 1, backgroundColor: theme.colors.surface0 }}>{request ? <Diff request={request} /> : <Notice>Choose a file in Source Control to see its diff.</Notice>}</View>
    </HostProvider>
  );
}

function Diff({ request: { cwd, source, file } }: { request: DiffRequest }) {
  const { c, small } = useHost();
  const read = useRpc(diffRpc);
  const fixed = source.kind !== "staged" && source.kind !== "changes"; // commits never change; the working tree keeps changing
  const patch = useQuery({
    queryKey: key("diff", cwd, source, file),
    queryFn: () => read({ cwd, source, file }),
    staleTime: fixed ? Infinity : 0,
    refetchInterval: fixed ? false : 3000,
  });
  const lines = useMemo(() => parsePatch(patch.data?.diff ?? ""), [patch.data]);
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderColor: c.border }}>
        <T weight="600" lines={1} style={{ flexShrink: 1, minWidth: 0 }}>
          {`${fileName(file)} (${compared(source, file)})`}
        </T>
        <T size={small} color={c.foregroundMuted} lines={1} style={{ flexShrink: 1000, minWidth: 0 }}>
          {file.from ? `${file.from} → ${file.path}` : file.path}
        </T>
      </View>
      {patch.error ? (
        <Notice failed>{patch.error.message}</Notice>
      ) : !patch.data ? (
        <Loading />
      ) : !lines.length ? (
        <Notice>No changes.</Notice>
      ) : (
        <FlatList style={{ flex: 1 }} data={lines} keyExtractor={(_, n) => String(n)} renderItem={({ item }) => <DiffLine line={item} />} />
      )}
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

function DiffLine({ line }: { line: Line }) {
  const { c, small } = useHost();
  const wash = line.kind === "add" ? c.statusSuccess : line.kind === "remove" ? c.statusDanger : null;
  const color = line.kind === "meta" ? c.foregroundMuted : line.kind === "hunk" ? c.accent : c.foreground;
  return (
    <View style={{ paddingHorizontal: 12 }}>
      {wash && <Tint color={wash} opacity={0.16} />}
      <T mono size={small + 1} color={color} selectable>
        {line.text || " "}
      </T>
    </View>
  );
}
