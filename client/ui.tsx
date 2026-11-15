// What every part of the panel is built from. Colours come from the host's theme, save those VS Code gives
// where the theme has no match: the graph's upstream and base branches, and the shadow under kept rows.

import type { PluginHostProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { StyleProp, TextStyle } from "react-native";
import * as codicon from "./codicons";
import type { Codicon } from "./codicons";

type Host = Pick<PluginHostProps, "theme" | "layout">;
const HostContext = createContext<Host | null>(null);
export const HostProvider = HostContext.Provider;

/**
 * Paseo's code font before "Code font" is set in its settings, which plugins are not told: on the web its default font
 * stack. Native apps take one font name, not a list. Code is 16px, chosen for this panel while Paseo's "Code size" is
 * not told to plugins either; its lines are 1.5 times that, as Paseo's diffs and VS Code's editor on macOS have them.
 */
const MONO = { ios: "Menlo", android: "monospace", web: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace" };
const CODE_SIZE = 16;

/** The theme and the sizes that follow from the layout: rows are taller where they are touched. */
export function useHost() {
  const host = useContext(HostContext);
  if (!host) throw new Error("useHost needs a HostProvider above it");
  const { compact, platform } = host.layout;
  const code = useMemo(() => codeFont(platform), [platform]);
  return { c: host.theme.colors, compact, platform, mono: MONO[platform], code, text: compact ? 15 : 13, small: compact ? 12 : 11, row: compact ? 34 : 24 };
}

/**
 * Code as the diff draws it. Paseo smooths all its text thinner (`-webkit-font-smoothing: antialiased` on its page);
 * code is drawn as VS Code draws it by default, its `workbench.fontAliasing` left at `default`.
 */
function codeFont(platform: Host["layout"]["platform"]) {
  const smoothing = platform === "web" ? ({ WebkitFontSmoothing: "auto" } as unknown as TextStyle) : {};
  return { fontFamily: MONO[platform], fontSize: CODE_SIZE, lineHeight: Math.round(CODE_SIZE * 1.5), ...smoothing };
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

/**
 * Whether a theme colour is dark: the theme names no appearance, only colours, and VS Code's own colours, which the
 * panel borrows where the theme has none, differ for dark and light. Paseo's colours come as #rrggbb.
 */
export function isDark(color: string) {
  const hex = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(color)?.[1];
  if (!hex) throw new Error(`A theme colour is not #rrggbb or #rgb: ${color}`);
  const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join("") : hex;
  const [r, g, b] = [0, 2, 4].map((at) => parseInt(full.slice(at, at + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.5;
}

/** The list with `item` taken out if it is in it, and put in if it is not. */
export const toggle = (list: string[], item: string) => (list.includes(item) ? list.filter((other) => other !== item) : [...list, item]);

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

// --- what floats over the panel: hints, menus and cards ---------------------------

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
  card(row: View, content: ReactNode, pinned: boolean): void; // pinned: until something else is pressed
  uncard(): void; // the pointer has left the row: in a moment, unless it is on the card or comes back first
  keep(): void; // the pointer is back on the row
}
const FloatingContext = createContext<Floating | null>(null);

function useFloating() {
  const floating = useContext(FloatingContext);
  if (!floating) throw new Error("Hints, menus and cards need a PanelRoot above them");
  return floating;
}

/**
 * The panel's root. Hints, menus and cards are drawn here, over everything else, so that no list can cut them off. A menu
 * or a card shows one at a time; a hint shows over either, for the buttons on a card.
 */
export function PanelRoot({ children }: { children: ReactNode }) {
  const { c, small, row } = useHost();
  const root = useRef<View>(null);
  const [hint, setHint] = useState<(Place & { text: string }) | null>(null);
  const [shown, show] = useState<(Place & ({ menu: MenuItem[] } | { card: ReactNode; pinned: boolean })) | null>(null);
  const leaving = useRef<ReturnType<typeof setTimeout>>(undefined);
  // React tells of the pointer coming onto the card before the row hears it leave, so the card remembers it.
  const onCard = useRef(false);
  useEffect(() => () => clearTimeout(leaving.current), []);
  const floating = useMemo<Floating>(() => {
    const locate = (button: View, then: (place: Place) => void) =>
      root.current?.measureInWindow((left, top, width, height) => button.measureInWindow((x, y, w, h) => then({ x: x - left, y: y - top, width: w, height: h, panel: { width, height } })));
    const keep = () => clearTimeout(leaving.current);
    return {
      hint: (button, text) => locate(button, (place) => setHint({ ...place, text })),
      unhint: () => setHint(null),
      menu: (button, items) => locate(button, (place) => show({ ...place, menu: items })),
      // A card does not take the place of an open menu, and only a pinned card stays when the pointer leaves it.
      card: (row, content, pinned) =>
        locate(row, (place) => {
          keep();
          onCard.current = false;
          show((shown) => (shown && "menu" in shown ? shown : { ...place, card: content, pinned }));
        }),
      uncard: () => {
        keep();
        if (onCard.current) return;
        leaving.current = setTimeout(() => show((shown) => (shown && "card" in shown && !shown.pinned ? null : shown)), 300);
      },
      keep,
    };
  }, []);
  // Under the button, or over it when there is no room below.
  const upright = (at: Place, needs: number) => (at.y + at.height + needs < at.panel.height ? { top: at.y + at.height + 4 } : { bottom: at.panel.height - at.y + 4 });
  const fromRight = (at: Place) => ({ right: Math.max(4, at.panel.width - at.x - at.width) });
  // Under a row in the upper half of the panel, over one in the lower half, and as tall as the room on that side.
  const beside = (at: Place) =>
    at.y + at.height / 2 < at.panel.height / 2
      ? { place: { top: at.y + at.height + 2 }, room: at.panel.height - at.y - at.height - 10 }
      : { place: { bottom: at.panel.height - at.y + 2 }, room: at.y - 10 };
  const box = { position: "absolute", borderWidth: 1, borderColor: c.border } as const;
  const fill = { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 } as const;
  return (
    <FloatingContext.Provider value={floating}>
      <View ref={root} style={{ flex: 1, backgroundColor: c.surface0 }}>
        {children}
        {shown && "card" in shown && (
          <>
            {shown.pinned && <Pressable accessibilityLabel="Close the card" onPress={() => show(null)} style={fill} />}
            {/* Not a Pressable: its hover ends when the pointer comes onto a button inside it. */}
            <View
              onPointerEnter={() => {
                onCard.current = true;
                floating.keep();
              }}
              onPointerLeave={() => {
                onCard.current = false;
                floating.uncard();
              }}
              style={[box, { left: 8, right: 8, borderRadius: 6, backgroundColor: c.surface1 }, beside(shown).place]}
            >
              <ScrollView style={{ maxHeight: beside(shown).room }} contentContainerStyle={{ padding: 10 }}>
                {shown.card}
              </ScrollView>
            </View>
          </>
        )}
        {shown && "menu" in shown && (
          <>
            {/* Anything outside the menu closes it. */}
            <Pressable accessibilityLabel="Close the menu" onPress={() => show(null)} style={fill} />
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
        {hint && (
          // A hint reaches towards the middle of the panel, and lets the pointer through.
          <View
            style={[
              box,
              { maxWidth: 260, paddingVertical: 3, paddingHorizontal: 7, borderRadius: 4, backgroundColor: c.surface2, pointerEvents: "none" },
              hint.x + hint.width / 2 < hint.panel.width / 2 ? { left: Math.max(4, hint.x) } : fromRight(hint),
              upright(hint, 28),
            ]}
          >
            <T size={small}>{hint.text}</T>
          </View>
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

/**
 * Shows `card()` once the pointer has rested on a row, and keeps it while the pointer moves onto it, as VS Code's hovers
 * do. Where there is no pointer, a long press shows it until something else is pressed. Spread the result into the row.
 */
export function useHoverCard(card: () => ReactNode) {
  const floating = useFloating();
  const ref = useRef<View>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const open = (pinned: boolean) => ref.current && floating.card(ref.current, card(), pinned);
  const leave = () => {
    clearTimeout(timer.current);
    floating.uncard();
  };
  return {
    ref,
    onHoverIn: () => {
      floating.keep();
      timer.current = setTimeout(() => open(false), 500);
    },
    onHoverOut: leave,
    onPressIn: leave,
    onLongPress: () => open(true),
  };
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

interface HeadingProps {
  title: string;
  folded: boolean;
  onFold: () => void;
  count?: number; // how many things it holds
  group?: boolean; // the title of a group of changes inside a section: as VS Code draws it, a step in and in plain text
  onChevron?: () => void; // given, the chevron is pressed apart from the rest of the title
  children?: ReactNode; // its actions
}

/** The title bar of something that folds: a section of the panel, or a group of changes. */
export function Heading({ title, folded, onFold, count, group, onChevron, children }: HeadingProps) {
  const { c, row, small } = useHost();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ expanded: !folded }}
      onPress={onFold}
      style={{ flexDirection: "row", alignItems: "center", gap: 4, height: row, paddingLeft: group ? 12 : 8, paddingRight: 8 }}
    >
      <Chevron folded={folded} label={title} onPress={onChevron} />
      {group ? (
        <T lines={1} style={{ flex: 1, minWidth: 0 }}>
          {title}
        </T>
      ) : (
        <T size={small} weight="600" color={c.foregroundMuted} lines={1} style={{ flex: 1, minWidth: 0, textTransform: "uppercase" }}>
          {title}
        </T>
      )}
      {children}
      {count !== undefined && (
        <T size={small} color={c.foregroundMuted} style={{ minWidth: 12, textAlign: "center" }}>
          {String(count)}
        </T>
      )}
    </Pressable>
  );
}

/** The arrow that says whether a row is folded. With `onPress`, pressing it is apart from pressing the row. */
export function Chevron({ folded, label, onPress }: { folded: boolean; label: string; onPress?: () => void }) {
  const { c, small } = useHost();
  const icon = <Icon icon={folded ? codicon.chevronRight : codicon.chevronDown} size={small + 5} color={c.foregroundMuted} />;
  if (!onPress) return icon;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${folded ? "Expand" : "Collapse"} ${label}`} hitSlop={4} onPress={onPress}>
      {icon}
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
