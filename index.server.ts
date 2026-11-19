import type { PluginServerContext } from "@getpaseo/plugin/server";
import { commit, compare, discard, ignore, log, markers, refs, remotes, remove, show, stage, status, sync, unstage } from "./server/git";
import { diff } from "./server/diff";
import { repositories } from "./server/repositories";
import { commitRpc, compareRpc, diffRpc, discardRpc, ignoreRpc, logRpc, markersRpc, refsRpc, remotesRpc, removeRpc, repositoriesRpc, showRpc, stageRpc, statusRpc, syncRpc, unstageRpc } from "./shared/git";

export default function contribute(server: PluginServerContext) {
  server.handle(repositoriesRpc, repositories);
  server.handle(statusRpc, status);
  server.handle(refsRpc, refs);
  server.handle(logRpc, log);
  server.handle(showRpc, show);
  server.handle(compareRpc, compare);
  server.handle(diffRpc, diff);
  server.handle(stageRpc, stage);
  server.handle(unstageRpc, unstage);
  server.handle(discardRpc, discard);
  server.handle(ignoreRpc, ignore);
  server.handle(removeRpc, remove);
  server.handle(markersRpc, markers);
  server.handle(remotesRpc, remotes);
  server.handle(commitRpc, commit);
  server.handle(syncRpc, sync);
  return () => {};
}
