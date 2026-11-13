// The Source Control panel, laid out like VS Code's: the workspace's repositories, the selected
// repository's working tree, and its commit graph. Each of the three scrolls on its own, and
// the lines between them drag.

import type { PluginTab, PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useRpc, useTabState, useWorkspace } from "@getpaseo/plugin/client";
import { Loading } from "@getpaseo/plugin/client/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { FlatList, Pressable, View } from "react-native";
import { z } from "zod";
import { logRpc, repositoriesRpc, scopeSchema } from "../shared/git";
import type { Commit, Repository, Scope } from "../shared/git";
import { Changes } from "./Changes";
import { key, useStatus } from "./git";
import { CommitItem, GraphHeader } from "./Graph";
import { layout as lanes } from "./lanes";
import { Repositories } from "./Repositories";
import { Split, sizesSchema } from "./Split";
import { HostProvider, Notice, PanelRoot, T, useHost } from "./ui";

const PAGE = 200; // commits read at first, and added by each "Load more"
const NONE: Commit[] = [];

const viewSchema = z.object({
  scope: scopeSchema,
  folded: z.array(z.string()), // the titles of the folded sections
  selected: z.string().nullable(), // a repository's root; null: the first one
  parent: z.boolean(), // the repository above the workspace's folder was asked for
  sizes: sizesSchema,
});
type ViewState = z.infer<typeof viewSchema>;
const VIEW: ViewState = { scope: "all", folded: [], selected: null, parent: false, sizes: { repositories: null, changes: null } };

export function Panel({ theme, layout, workspaceId, tab }: PluginWorkspacePanelProps) {
  const directory = useWorkspace(workspaceId, (workspace) => workspace.directory);
  const host = useMemo(() => ({ theme, layout }), [theme, layout]);
  return (
    <HostProvider value={host}>
      <PanelRoot>{directory === null ? <Notice>This workspace is unavailable.</Notice> : <Workspace key={directory} directory={directory} workspaceId={workspaceId} tab={tab} />}</PanelRoot>
    </HostProvider>
  );
}

/** Lists the repositories of the workspace's folder and shows the selected one. */
function Workspace({ directory, workspaceId, tab }: { directory: string; workspaceId: string; tab: PluginTab }) {
  const { c } = useHost();
  const [view, setView] = useTabState(tab, viewSchema, VIEW);
  const read = useRpc(repositoriesRpc);
  const found = useQuery({ queryKey: key("repositories", directory), queryFn: () => read({ cwd: directory }), refetchInterval: 10_000 });
  if (!found.data) return found.error ? <Notice failed>{found.error.message}</Notice> : <Loading />;

  const { parent } = found.data;
  const list: Repository[] = view.parent && parent ? [...found.data.repositories, parent] : found.data.repositories;
  if (!list.length)
    return (
      <View>
        <Notice>No git repository in this folder.</Notice>
        {parent && (
          <Pressable accessibilityRole="button" onPress={() => setView({ ...view, parent: true })} style={{ paddingHorizontal: 12 }}>
            <T color={c.accent}>{`Open ${parent.name}, the repository this folder is in`}</T>
          </Pressable>
        )}
      </View>
    );
  const selected = list.find((repository) => repository.root === view.selected) ?? list[0];
  const cwd = selected.root;
  const fold = (title: string) => setView({ ...view, folded: view.folded.includes(title) ? view.folded.filter((name) => name !== title) : [...view.folded, title] });
  const folded = view.folded.includes("Repositories");
  return (
    <>
      {found.error && <Notice failed>{found.error.message}</Notice>}
      <Split
        sizes={view.sizes}
        onSizes={(sizes) => setView({ ...view, sizes })}
        folded={folded}
        repositories={<Repositories list={list} selected={selected} folded={folded} onFold={() => fold("Repositories")} onSelect={(root) => setView({ ...view, selected: root })} />}
        changes={<WorkingTree key={cwd} cwd={cwd} workspaceId={workspaceId} folded={view.folded} onFold={fold} />}
        graph={<History key={cwd} cwd={cwd} workspaceId={workspaceId} scope={view.scope} onScope={(scope) => setView({ ...view, scope })} />}
      />
    </>
  );
}

/** The selected repository's working tree. It also speaks for the repository while it loads or fails. */
function WorkingTree({ cwd, workspaceId, folded, onFold }: { cwd: string; workspaceId: string; folded: string[]; onFold: (title: string) => void }) {
  const status = useStatus(cwd);
  if (!status.data) return status.error ? <Notice failed>{status.error.message}</Notice> : <Loading />;
  return (
    <>
      {status.error && <Notice failed>{status.error.message}</Notice>}
      <Changes cwd={cwd} workspaceId={workspaceId} status={status.data} folded={folded} onFold={onFold} />
    </>
  );
}

/** The selected repository's commit graph. */
function History({ cwd, workspaceId, scope, onScope }: { cwd: string; workspaceId: string; scope: Scope; onScope: (scope: Scope) => void }) {
  const { c, row } = useHost();
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null); // the commit whose details show
  const status = useStatus(cwd).data;
  const read = useRpc(logRpc);
  const history = useQuery({
    // The history is read again whenever HEAD or any ref has moved.
    queryKey: key("log", cwd, scope, limit, status?.head, status?.branch, status?.refs),
    queryFn: () => read({ cwd, scope, limit }),
    enabled: Boolean(status?.head),
    placeholderData: keepPreviousData,
  });
  const commits = history.data?.commits ?? NONE;
  const rails = useMemo(() => lanes(commits), [commits]);
  if (!status) return null;
  return (
    <>
      <GraphHeader cwd={cwd} scope={scope} onScope={onScope} />
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
