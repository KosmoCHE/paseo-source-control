// The browser preview: the Source Control panel as a sidebar, the diff tab beside it.
//
// Address parameters: cwd (the repository), theme=light, compact, width (of the sidebar),
// press, a "|"-separated list of button names to click in turn once they appear, and hover,
// one button to rest the pointer on after that: how a screenshot reaches a state behind them.

import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { View } from "react-native";
import { DiffPanel } from "../client/Diff";
import { bindDiffTab } from "../client/diffTab";
import { Panel } from "../client/Panel";

const params = new URLSearchParams(location.search);

// Close to Paseo's own dark and light themes; the plugin itself never names a colour.
const dark = {
  surface0: "#17171a",
  surface1: "#1e1e22",
  surface2: "#26262b",
  border: "#303036",
  foreground: "#e6e6ea",
  foregroundMuted: "#9a9aa5",
  accent: "#4c8dff",
  accentForeground: "#ffffff",
  statusSuccess: "#3fb950",
  statusWarning: "#f0a020",
  statusDanger: "#f0524f",
};
const light = {
  ...dark,
  surface0: "#ffffff",
  surface1: "#f6f6f7",
  surface2: "#ededf0",
  border: "#dcdce0",
  foreground: "#1c1c1f",
  foregroundMuted: "#6b6b76",
  accent: "#2563eb",
};

const props: PluginWorkspacePanelProps = {
  theme: { colors: params.get("theme") === "light" ? light : dark },
  host: { id: "preview", label: "Preview" },
  layout: { compact: params.has("compact"), platform: "web" },
  workspaceId: "preview",
  params: {},
  revision: 0,
  tab: { state: undefined, setState() {}, setModified() {} },
  context: "workspace",
};

bindDiffTab(() => {}); // the diff tab is always on screen here

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient()}>
    <View style={{ flex: 1, flexDirection: "row", backgroundColor: props.theme.colors.surface0 }}>
      <View style={{ width: Number(params.get("width") ?? 380), borderRightWidth: 1, borderColor: props.theme.colors.border }}>
        <Panel {...props} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <DiffPanel {...props} />
      </View>
    </View>
  </QueryClientProvider>,
);

// A button is known by its label, or by its text when it has none; an exact match wins over a prefix.
function button(name: string) {
  const named = [...document.querySelectorAll<HTMLElement>("[aria-label], [role=button]")].map((element) => ({ element, name: element.getAttribute("aria-label") ?? element.textContent ?? "" }));
  return (named.find((candidate) => candidate.name === name) ?? named.find((candidate) => candidate.name.startsWith(name)))?.element;
}

const presses = (params.get("press") ?? "").split("|").filter(Boolean);
const hover = params.get("hover");
const timer = setInterval(() => {
  const target = button(presses[0] ?? hover ?? "");
  if (!target) return void (presses.length || hover || clearInterval(timer));
  if (presses.shift()) return target.click();
  target.dispatchEvent(new PointerEvent("pointerenter", { pointerType: "mouse" }));
  clearInterval(timer);
}, 100);
