import type { PluginClientContext } from "@getpaseo/plugin/client";
import { DiffPanel } from "./client/Diff";
import { bindDiffTab } from "./client/diffTab";
import { Panel } from "./client/Panel";

export default function contribute(client: PluginClientContext) {
  client.addWorkspacePanel({
    id: "source-control",
    title: "Source Control",
    icon: "GitGraph",
    locations: ["explorer", "workspace"],
    Component: Panel,
  });
  // Opened from the panel above, with the file it should show.
  // A plugin's tab keeps the title it was registered with: the file and what it is compared with are named inside it.
  client.addWorkspacePanel({ id: "diff", title: "Git Diff", icon: "FileDiff", Component: DiffPanel });
  return bindDiffTab((workspaceId) => client.openPanel("diff", { workspaceId, location: "workspace" }));
}
