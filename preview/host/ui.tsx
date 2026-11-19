// Stands in for @getpaseo/plugin/client/ui in the browser preview. Rough on purpose:
// these are the host's pieces, and only their place in the layout matters here.

import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { Text, View } from "react-native";
export { FlatList, TextInput } from "react-native";

/** The panel only uses inline SVG. The host draws it at the size asked for, in the colour asked for. */
export function Icon({ icon, size = 24, color }: { icon: { svg: string }; size?: number; color?: string }) {
  return <span style={{ display: "flex", color }} dangerouslySetInnerHTML={{ __html: icon.svg.replace('width="16" height="16"', `width="${size}" height="${size}"`) }} />;
}

/** Paseo's Markdown, for the one link the panel draws: a press says which file Paseo would open. */
export function Markdown({ children }: { children: string }) {
  const link = /^\[(.*)\]\((.*)\)$/.exec(children);
  if (!link) throw new Error(`The preview's Markdown draws a single link only: ${children}`);
  const open = (event: { preventDefault(): void }) => {
    event.preventDefault();
    say(`Paseo would open ${decodeURIComponent(new URL(link[2], "http://paseo.invalid").pathname)}`);
  };
  return (
    <a href={link[2]} onClick={open}>
      {link[1]}
    </a>
  );
}

export function Loading() {
  return <Text style={{ padding: 12, color: "gray" }}>Loading…</Text>;
}

function say(message: string) {
  const toast = Object.assign(document.createElement("div"), { textContent: message });
  toast.setAttribute("style", "position:fixed;bottom:16px;left:16px;padding:8px 12px;border-radius:6px;background:#333;color:#fff;font:13px system-ui;white-space:pre-wrap");
  document.body.append(toast);
  setTimeout(() => toast.remove(), 3200);
}

export function useToast() {
  return { show: say, error: say };
}

export const copyText = (text: string) => navigator.clipboard.writeText(text);

export function Modal({ title, open, children }: { title: string; open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode }) {
  if (!open) return null;
  // On the page's body, as Paseo draws its modals over everything: inside the panel, a later section would cover it.
  return createPortal(
    <View style={{ position: "fixed" as "absolute", inset: 0, zIndex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#0008" }}>
      <View style={{ width: 360, borderRadius: 8, backgroundColor: "#26262b" }}>
        <Text style={{ padding: 16, fontWeight: "600", color: "#fff" }}>{title}</Text>
        {children}
      </View>
    </View>,
    document.body,
  );
}
Modal.Content = function Content({ children, scrollable = true }: { children: ReactNode; scrollable?: boolean }) {
  return <View style={scrollable ? { padding: 24, gap: 16 } : { height: Math.min(480, window.innerHeight * 0.65) }}>{children}</View>;
};
