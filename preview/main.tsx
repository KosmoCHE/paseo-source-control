// The browser preview: the Source Control panel as a sidebar, the diff tab beside it.
//
// Address parameters: cwd (the repository), theme=light, compact, width (of the sidebar),
// and three that act once what they name appears, which is how a screenshot reaches a state
// behind them: press, a "|"-separated list of buttons to click in turn; drag, a divider and
// how far down to pull it ("Resize Changes:120"); hover, a button to rest the pointer on.

import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { View } from "react-native";
import { DiffPanel } from "../client/Diff";
import { bindDiffTab } from "../client/diffTab";
import { Panel } from "../client/Panel";

const params = new URLSearchParams(location.search);

// Close to Paseo's own dark and light themes; the plugin names no colour of its own but VS Code's two for the graph's branches.
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

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
async function found(name: string) {
  for (;;) {
    const element = button(name);
    if (element) return element;
    await wait(100);
  }
}

void (async () => {
  for (const name of (params.get("press") ?? "").split("|").filter(Boolean)) {
    (await found(name)).click();
    await wait(100); // the next button is looked for on the page as the click left it, not as it was
  }
  const [line, by] = (params.get("drag") ?? "").split(":");
  if (line) {
    const element = await found(line);
    const box = element.getBoundingClientRect();
    const at = (dy: number) => ({ bubbles: true, button: 0, clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 + dy });
    element.dispatchEvent(new MouseEvent("mousedown", at(0)));
    for (let step = 1; step <= 4; step++) {
      element.dispatchEvent(new MouseEvent("mousemove", at((Number(by) * step) / 4)));
      await wait(30);
    }
    element.dispatchEvent(new MouseEvent("mouseup", at(Number(by))));
  }
  const hover = params.get("hover");
  if (hover) (await found(hover)).dispatchEvent(new PointerEvent("pointerenter", { pointerType: "mouse" }));
})();
