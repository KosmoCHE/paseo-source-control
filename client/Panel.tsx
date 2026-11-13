// The Source Control panel: the working tree on top, the commit graph below, in one scroll.

import type { PluginTab, PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useRpc, useTabState, useWorkspace } from "@getpaseo/plugin/client";
import { Loading } from "@getpaseo/plugin/client/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { FlatList, Pressable, View } from "react-native";
import { z } from "zod";
import { logRpc, scopeSchema, statusRpc } from "../shared/git";
import type { Commit } from "../shared/git";
import { Changes } from "./Changes";
import { key } from "./git";
import { CommitItem, GraphHeader } from "./Graph";
import { layout as lanes } from "./lanes";
import { HostProvider, Notice, T, useHost } from "./ui";

const PAGE = 200; // commits read at first, and added by each "Load more"
const POLL = 3000; // how often the repository is read again, in milliseconds
const NONE: Commit[] = [];

const viewSchema = z.object({ scope: scopeSchema, folded: z.array(z.string()) });
type ViewState = z.infer<typeof viewSchema>;
const VIEW: ViewState = { scope: "current", folded: [] };

export function Panel({ theme, layout, workspaceId, tab }: PluginWorkspacePanelProps) {
  const cwd = useWorkspace(workspaceId, (workspace) => workspace.directory);
  const host = useMemo(() => ({ theme, layout }), [theme, layout]);
  return (
    <HostProvider value={host}>
      <View style={{ flex: 1, backgroundColor: theme.colors.surface0 }}>
        {cwd === null ? <Notice>This workspace is unavailable.</Notice> : <SourceControl key={cwd} cwd={cwd} workspaceId={workspaceId} tab={tab} />}
      </View>
    </HostProvider>
  );
}

function SourceControl({ cwd, workspaceId, tab }: { cwd: string; workspaceId: string; tab: PluginTab }) {
  const { c, row } = useHost();
  const [view, setView] = useTabState(tab, viewSchema, VIEW);
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null); // the commit whose details show
  const readStatus = useRpc(statusRpc);
  const readLog = useRpc(logRpc);
  const status = useQuery({ queryKey: key(cwd, "status"), queryFn: () => readStatus({ cwd }), refetchInterval: POLL });
  const now = status.data;
  const history = useQuery({
    // The history is read again whenever HEAD or any ref has moved.
    queryKey: key(cwd, "log", view.scope, limit, now?.head, now?.branch, now?.refs),
    queryFn: () => readLog({ cwd, scope: view.scope, limit }),
    enabled: Boolean(now?.head),
    placeholderData: keepPreviousData,
  });
  const commits = history.data?.commits ?? NONE;
  const rails = useMemo(() => lanes(commits), [commits]);

  if (!now) return status.error ? <Notice failed>{status.error.message}</Notice> : <Loading />;
  const fold = (group: string) => setView({ ...view, folded: view.folded.includes(group) ? view.folded.filter((name) => name !== group) : [...view.folded, group] });
  return (
    <FlatList
      style={{ flex: 1 }}
      data={commits}
      extraData={open}
      keyExtractor={(commit) => commit.hash}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View>
          {status.error && <Notice failed>{status.error.message}</Notice>}
          <Changes cwd={cwd} workspaceId={workspaceId} status={now} folded={view.folded} onFold={fold} />
          <GraphHeader cwd={cwd} scope={view.scope} onScope={(scope) => setView({ ...view, scope })} />
        </View>
      }
      renderItem={({ item, index }) => (
        <CommitItem
          cwd={cwd}
          workspaceId={workspaceId}
          commit={item}
          rail={rails[index]}
          open={item.hash === open}
          onToggle={() => setOpen(item.hash === open ? null : item.hash)}
        />
      )}
      ListFooterComponent={
        history.error ? (
          <Notice failed>{history.error.message}</Notice>
        ) : now.head === null ? (
          <Notice>No commits yet.</Notice>
        ) : !history.data ? (
          <Loading />
        ) : history.data.more ? (
          <Pressable accessibilityRole="button" onPress={() => setLimit(limit + PAGE)} style={{ height: row + 8, alignItems: "center", justifyContent: "center" }}>
            <T color={c.accent}>{history.isPlaceholderData ? "Loading…" : "Load more"}</T>
          </Pressable>
        ) : null
      }
    />
  );
}
