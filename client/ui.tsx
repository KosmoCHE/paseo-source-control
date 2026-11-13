// What every part of the panel is built from. Colours come from the host's theme only.

import type { PluginHostProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import type { StyleProp, TextStyle } from "react-native";
import * as codicon from "./codicons";
import type { Codicon } from "./codicons";

type Host = Pick<PluginHostProps, "theme" | "layout">;
const HostContext = createContext<Host | null>(null);
export const HostProvider = HostContext.Provider;

const MONO = { ios: "Menlo", android: "monospace", web: "ui-monospace, Menlo, Consolas, monospace" };

/** The theme and the sizes that follow from the layout: rows are taller where they are touched. */
export function useHost() {
  const host = useContext(HostContext);
  if (!host) throw new Error("useHost needs a HostProvider above it");
  const { compact, platform } = host.layout;
  return { c: host.theme.colors, compact, platform, mono: MONO[platform], text: compact ? 15 : 13, small: compact ? 12 : 11, row: compact ? 34 : 24 };
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

// --- what floats over the panel: hints and menus -----------------------------------

export interface MenuItem {
  label: string;
  enabled: boolean;
  onPress: () => void;
}
/** A button's box inside the panel, and the panel's size. */
interface Place {
  x: number;
  y: number;
  width: number;
  height: number;
  panel: { width: number; height: number };
}
interface Floating {
  hint(button: View, text: string): void;
  unhint(): void;
  menu(button: View, items: MenuItem[]): void;
}
const FloatingContext = createContext<Floating | null>(null);

function useFloating() {
  const floating = useContext(FloatingContext);
  if (!floating) throw new Error("Hints and menus need a PanelRoot above them");
  return floating;
}

/** The panel's root. Hints and menus are drawn here, over everything else, so that no list can cut them off. */
export function PanelRoot({ children }: { children: ReactNode }) {
  const { c, small, row } = useHost();
  const root = useRef<View>(null);
  const [shown, show] = useState<(Place & ({ hint: string } | { menu: MenuItem[] })) | null>(null);
  const floating = useMemo(() => {
    const locate = (button: View, then: (place: Place) => void) =>
      root.current?.measureInWindow((left, top, width, height) => button.measureInWindow((x, y, w, h) => then({ x: x - left, y: y - top, width: w, height: h, panel: { width, height } })));
    // A menu stays until it is answered: the pointer leaving the button that opened it takes away a hint only.
    return {
      hint: (button: View, text: string) => locate(button, (place) => show((shown) => (shown && "menu" in shown ? shown : { ...place, hint: text }))),
      unhint: () => show((shown) => (shown && "hint" in shown ? null : shown)),
      menu: (button: View, items: MenuItem[]) => locate(button, (place) => show({ ...place, menu: items })),
    };
  }, []);
  // Under the button, or over it when there is no room below.
  const upright = (at: Place, needs: number) => (at.y + at.height + needs < at.panel.height ? { top: at.y + at.height + 4 } : { bottom: at.panel.height - at.y + 4 });
  const fromRight = (at: Place) => ({ right: Math.max(4, at.panel.width - at.x - at.width) });
  const box = { position: "absolute", borderWidth: 1, borderColor: c.border } as const;
  return (
    <FloatingContext.Provider value={floating}>
      <View ref={root} style={{ flex: 1, backgroundColor: c.surface0 }}>
        {children}
        {shown && "hint" in shown && (
          // A hint reaches towards the middle of the panel, and lets the pointer through.
          <View
            style={[
              box,
              { maxWidth: 260, paddingVertical: 3, paddingHorizontal: 7, borderRadius: 4, backgroundColor: c.surface2, pointerEvents: "none" },
              shown.x + shown.width / 2 < shown.panel.width / 2 ? { left: Math.max(4, shown.x) } : fromRight(shown),
              upright(shown, 28),
            ]}
          >
            <T size={small}>{shown.hint}</T>
          </View>
        )}
        {shown && "menu" in shown && (
          <>
            {/* Anything outside the menu closes it. */}
            <Pressable accessibilityLabel="Close the menu" onPress={() => show(null)} style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }} />
            <View style={[box, { minWidth: 170, paddingVertical: 4, borderRadius: 6, backgroundColor: c.surface1 }, fromRight(shown), upright(shown, shown.menu.length * (row + 4) + 12)]}>
              {shown.menu.map((item) => (
                <Pressable
                  key={item.label}
                  accessibilityRole="menuitem"
                  accessibilityLabel={item.label}
                  accessibilityState={{ disabled: !item.enabled }}
                  disabled={!item.enabled}
                  onPress={() => {
                    show(null);
                    item.onPress();
                  }}
                  style={({ pressed }) => ({ height: row + 4, justifyContent: "center", paddingHorizontal: 12, opacity: item.enabled ? 1 : 0.4, backgroundColor: pressed ? c.surface2 : undefined })}
                >
                  <T>{item.label}</T>
                </Pressable>
              ))}
            </View>
          </>
        )}
      </View>
    </FloatingContext.Provider>
  );
}

/** Makes a Pressable say what it does once the pointer has rested on it. Spread the result into it. */
export function useHint(text: string) {
  const floating = useFloating();
  const ref = useRef<View>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hide = () => {
    clearTimeout(timer.current);
    floating.unhint();
  };
  useEffect(() => () => clearTimeout(timer.current), []); // a button that goes away does not speak afterwards
  return {
    ref,
    onHoverIn: () => {
      timer.current = setTimeout(() => ref.current && floating.hint(ref.current, text), 500);
    },
    onHoverOut: hide,
    onPressIn: hide,
  };
}

/** Opens a menu under a button: `open(button, items)`. Choosing an item, or pressing anywhere else, closes it. */
export function useMenu() {
  return useFloating().menu;
}

/** `hint` is what hovering shows; it is the label unless the label names a file. */
export function IconButton({ icon, label, hint, onPress, disabled }: { icon: Codicon; label: string; hint?: string; onPress: () => void; disabled?: boolean }) {
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
      <Icon icon={icon} size={compact ? 18 : 16} color={c.foregroundMuted} />
    </Pressable>
  );
}

/** The title bar of a section that folds. `children` are its actions, `count` how many things it holds. */
export function Heading({ title, folded, onFold, count, children }: { title: string; folded: boolean; onFold: () => void; count?: number; children?: ReactNode }) {
  const { c, row, small } = useHost();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ expanded: !folded }} onPress={onFold} style={{ flexDirection: "row", alignItems: "center", gap: 4, height: row, paddingHorizontal: 8 }}>
      <Icon icon={folded ? codicon.chevronRight : codicon.chevronDown} size={small + 5} color={c.foregroundMuted} />
      <T size={small} weight="600" color={c.foregroundMuted} lines={1} style={{ flex: 1, minWidth: 0, textTransform: "uppercase" }}>
        {title}
      </T>
      {children}
      {count !== undefined && (
        <T size={small} color={c.foregroundMuted} style={{ minWidth: 12, textAlign: "center" }}>
          {String(count)}
        </T>
      )}
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
