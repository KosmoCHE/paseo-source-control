// What every part of the panel is built from. Colours come from the host's theme only.

import type { PluginHostProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import type { StyleProp, TextStyle } from "react-native";
import type { FileChange } from "../shared/git";

type Host = Pick<PluginHostProps, "theme" | "layout">;
const HostContext = createContext<Host | null>(null);
export const HostProvider = HostContext.Provider;

const MONO = { ios: "Menlo", android: "monospace", web: "ui-monospace, Menlo, Consolas, monospace" };

/** The theme and the sizes that follow from the layout: rows are taller where they are touched. */
export function useHost() {
  const host = useContext(HostContext);
  if (!host) throw new Error("useHost needs a HostProvider above it");
  const { compact, platform } = host.layout;
  return { c: host.theme.colors, compact, mono: MONO[platform], text: compact ? 15 : 13, small: compact ? 12 : 11, row: compact ? 34 : 24 };
}

interface TProps {
  children: ReactNode;
  size?: number;
  color?: string;
  weight?: "600";
  mono?: boolean;
  lines?: number;
  selectable?: boolean;
  style?: StyleProp<TextStyle>;
}

/** Text in the theme's colours. */
export function T({ children, size, color, weight, mono, lines, selectable, style }: TProps) {
  const host = useHost();
  return (
    <Text
      numberOfLines={lines}
      selectable={selectable}
      style={[{ color: color ?? host.c.foreground, fontSize: size ?? host.text, fontWeight: weight }, mono && { fontFamily: host.mono }, style]}
    >
      {children}
    </Text>
  );
}

/** A wash of colour behind a row: the theme has no translucent tokens. */
export function Tint({ color, opacity }: { color: string; opacity: number }) {
  return <View style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: color, opacity, pointerEvents: "none" }} />;
}

export function IconButton({ name, label, onPress, disabled }: { name: string; label: string; onPress: () => void; disabled?: boolean }) {
  const { c, compact } = useHost();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => ({ padding: compact ? 6 : 3, borderRadius: 4, opacity: disabled ? 0.4 : pressed ? 0.6 : 1 })}
    >
      <Icon name={name} size={compact ? 18 : 15} color={c.foregroundMuted} />
    </Pressable>
  );
}

/** A line that stands in for content: nothing here yet, or what went wrong. */
export function Notice({ children, failed }: { children: string; failed?: boolean }) {
  const { c, small } = useHost();
  return (
    <T size={small + 1} color={failed ? c.statusDanger : c.foregroundMuted} selectable={failed} style={{ padding: 12 }}>
      {children}
    </T>
  );
}

/** The letter and colour VS Code gives a file's state. */
function mark(status: string, c: Host["theme"]["colors"]) {
  if (status === "?") return { letter: "U", color: c.statusSuccess };
  if (status === "A") return { letter: "A", color: c.statusSuccess };
  if (status === "D") return { letter: "D", color: c.statusDanger };
  if (status === "U") return { letter: "!", color: c.statusDanger };
  if (status === "R" || status === "C") return { letter: status, color: c.accent };
  return { letter: "M", color: c.statusWarning };
}

/** One changed file: its name, where it lives, what happened to it. `actions` sit before the status letter. */
export function FileRow({ file, onPress, actions, indent = 0 }: { file: FileChange; onPress: () => void; actions?: ReactNode; indent?: number }) {
  const { c, row, small } = useHost();
  const cut = file.path.lastIndexOf("/") + 1;
  const { letter, color } = mark(file.status, c);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${file.path}, ${letter}`}
      onPress={onPress}
      style={{ flexDirection: "row", alignItems: "center", height: row, paddingLeft: indent, paddingRight: 8, gap: 6 }}
    >
      <T lines={1} style={[{ flexShrink: 1, minWidth: 0 }, file.status === "D" && { textDecorationLine: "line-through" }]}>
        {file.path.slice(cut)}
      </T>
      <T size={small} color={c.foregroundMuted} lines={1} style={{ flex: 1, flexShrink: 1000, minWidth: 0 }}>
        {file.path.slice(0, Math.max(0, cut - 1)) + (file.from ? ` ← ${file.from}` : "")}
      </T>
      {actions}
      <T size={small} weight="600" color={color} style={{ width: 12, textAlign: "center" }}>
        {letter}
      </T>
    </Pressable>
  );
}
