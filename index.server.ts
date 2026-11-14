import type { PluginServerContext } from "@getpaseo/plugin/server";
import { commit, compare, diff, discard, log, show, stage, status, sync, unstage } from "./server/git";
import { repositories } from "./server/repositories";
import { commitRpc, compareRpc, diffRpc, discardRpc, logRpc, repositoriesRpc, showRpc, stageRpc, statusRpc, syncRpc, unstageRpc } from "./shared/git";

export default function contribute(server: PluginServerContext) {
  server.handle(repositoriesRpc, repositories);
  server.handle(statusRpc, status);
  server.handle(logRpc, log);
  server.handle(showRpc, show);
  server.handle(compareRpc, compare);
  server.handle(diffRpc, diff);
  server.handle(stageRpc, stage);
  server.handle(unstageRpc, unstage);
  server.handle(discardRpc, discard);
  server.handle(commitRpc, commit);
  server.handle(syncRpc, sync);
  return () => {};
}
