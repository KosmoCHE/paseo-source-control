// The Source Control panel: the working tree on top, the commit graph below.

import type { PluginTab, PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useRpc, useTabState, useWorkspace } from "@getpaseo/plugin/client";
import { Loading } from "@getpaseo/plugin/client/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { FlatList, Pressable, ScrollView, View } from "react-native";
import { z } from "zod";
import { logRpc, scopeSchema, statusRpc } from "../shared/git";
import type { Commit, Status } from "../shared/git";
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
const VIEW: ViewState = { scope: "all", folded: [] };

export function Panel({ theme, layout, workspaceId, tab }: PluginWorkspacePanelProps) {
  const directory = useWorkspace(workspaceId, (workspace) => workspace.directory);
  const host = useMemo(() => ({ theme, layout }), [theme, layout]);
  return (
    <HostProvider value={host}>
      <View style={{ flex: 1, backgroundColor: theme.colors.surface0 }}>
        {directory === null ? <Notice>This workspace is unavailable.</Notice> : <SourceControl key={directory} directory={directory} workspaceId={workspaceId} tab={tab} />}
      </View>
    </HostProvider>
  );
}

/** Keeps reading the repository the workspace's directory is in; that directory need not be its root. */
function SourceControl({ directory, workspaceId, tab }: { directory: string; workspaceId: string; tab: PluginTab }) {
  const read = useRpc(statusRpc);
  const status = useQuery({ queryKey: key("status", directory), queryFn: () => read({ cwd: directory }), refetchInterval: POLL });
  if (!status.data) return status.error ? <Notice failed>{status.error.message}</Notice> : <Loading />;
  return (
    <View style={{ flex: 1 }}>
      {status.error && <Notice failed>{status.error.message}</Notice>}
      <Repository status={status.data} workspaceId={workspaceId} tab={tab} />
    </View>
  );
}

function Repository({ status, workspaceId, tab }: { status: Status; workspaceId: string; tab: PluginTab }) {
  const { c, row } = useHost();
  const cwd = status.root;
  const [view, setView] = useTabState(tab, viewSchema, VIEW);
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null); // the commit whose details show
  const read = useRpc(logRpc);
  const history = useQuery({
    // The history is read again whenever HEAD or any ref has moved.
    queryKey: key("log", cwd, view.scope, limit, status.head, status.branch, status.refs),
    queryFn: () => read({ cwd, scope: view.scope, limit }),
    enabled: status.head !== null,
    placeholderData: keepPreviousData,
  });
  const commits = history.data?.commits ?? NONE;
  const rails = useMemo(() => lanes(commits), [commits]);
  const fold = (group: string) => setView({ ...view, folded: view.folded.includes(group) ? view.folded.filter((name) => name !== group) : [...view.folded, group] });
  return (
    <>
      {/* The two halves scroll on their own, as in VS Code. The working tree takes what it needs, up to half the panel. */}
      <ScrollView style={{ flexGrow: 0, maxHeight: "50%" }} keyboardShouldPersistTaps="handled">
        <Changes cwd={cwd} workspaceId={workspaceId} status={status} folded={view.folded} onFold={fold} />
      </ScrollView>
      <GraphHeader cwd={cwd} scope={view.scope} onScope={(scope) => setView({ ...view, scope })} />
      <FlatList
        style={{ flex: 1 }}
        data={commits}
        extraData={open}
        keyExtractor={(commit) => commit.hash}
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
          ) : status.head === null ? (
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
    </>
  );
}
