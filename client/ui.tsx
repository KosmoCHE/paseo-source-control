// What every part of the panel is built from. Colours come from the host's theme only.

import type { PluginHostProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
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

// --- hints ------------------------------------------------------------------------

interface Hint {
  text: string;
  x: number; // the button's box, inside the panel
  y: number;
  width: number;
  height: number;
  panel: { width: number; height: number };
}
const HintContext = createContext<{ show(button: View, text: string): void; hide(): void } | null>(null);

/** The panel's root. Hints are drawn here, over everything else, so that no list can cut them off. */
export function HintHost({ children }: { children: ReactNode }) {
  const { c, small } = useHost();
  const root = useRef<View>(null);
  const [hint, setHint] = useState<Hint | null>(null);
  const hints = useMemo(
    () => ({
      show(button: View, text: string) {
        root.current?.measureInWindow((left, top, width, height) =>
          button.measureInWindow((x, y, w, h) => setHint({ text, x: x - left, y: y - top, width: w, height: h, panel: { width, height } })),
        );
      },
      hide: () => setHint(null),
    }),
    [],
  );
  // Under the button and towards the middle of the panel; over the button when there is no room below.
  const place = (at: Hint) => ({
    ...(at.x + at.width / 2 < at.panel.width / 2 ? { left: Math.max(4, at.x) } : { right: Math.max(4, at.panel.width - at.x - at.width) }),
    ...(at.y + at.height + 32 < at.panel.height ? { top: at.y + at.height + 4 } : { bottom: at.panel.height - at.y + 4 }),
  });
  return (
    <HintContext.Provider value={hints}>
      <View ref={root} style={{ flex: 1, backgroundColor: c.surface0 }}>
        {children}
        {hint && (
          <View
            style={[
              { position: "absolute", maxWidth: 260, paddingVertical: 3, paddingHorizontal: 7, borderWidth: 1, borderRadius: 4, borderColor: c.border, backgroundColor: c.surface2, pointerEvents: "none" },
              place(hint),
            ]}
          >
            <T size={small}>{hint.text}</T>
          </View>
        )}
      </View>
    </HintContext.Provider>
  );
}

/** Makes a Pressable say what it does once the pointer has rested on it. Spread the result into it. */
export function useHint(text: string) {
  const hints = useContext(HintContext);
  if (!hints) throw new Error("useHint needs a HintHost above it");
  const ref = useRef<View>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hide = () => {
    clearTimeout(timer.current);
    hints.hide();
  };
  useEffect(() => hide, []); // a button that goes away takes its hint with it
  return {
    ref,
    onHoverIn: () => {
      timer.current = setTimeout(() => ref.current && hints.show(ref.current, text), 500);
    },
    onHoverOut: hide,
    onPressIn: hide,
  };
}

/** `hint` is what hovering shows; it is the label unless the label names a file. */
export function IconButton({ name, label, hint, onPress, disabled }: { name: string; label: string; hint?: string; onPress: () => void; disabled?: boolean }) {
  const { c, compact } = useHost();
  return (
    <Pressable
      {...useHint(hint ?? label)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      hitSlop={4}
      onPress={disabled ? undefined : onPress} // not the disabled prop: that would switch off hovering, and the hint with it
      style={({ pressed }) => ({ padding: compact ? 6 : 3, borderRadius: 4, opacity: disabled ? 0.4 : pressed ? 0.6 : 1 })}
    >
      <Icon name={name} size={compact ? 18 : 15} color={c.foregroundMuted} />
    </Pressable>
  );
}

/** The title bar of a section that folds. `children` are its actions. */
export function Heading({ title, folded, onFold, count, children }: { title: string; folded: boolean; onFold: () => void; count: number; children?: ReactNode }) {
  const { c, row, small } = useHost();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ expanded: !folded }} onPress={onFold} style={{ flexDirection: "row", alignItems: "center", gap: 4, height: row, paddingHorizontal: 8 }}>
      <Icon name={folded ? "ChevronRight" : "ChevronDown"} size={small + 3} color={c.foregroundMuted} />
      <T size={small} weight="600" color={c.foregroundMuted} lines={1} style={{ flex: 1, minWidth: 0, textTransform: "uppercase" }}>
        {title}
      </T>
      {children}
      <T size={small} color={c.foregroundMuted} style={{ minWidth: 12, textAlign: "center" }}>
        {String(count)}
      </T>
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
