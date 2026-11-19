// VS Code's SCM HistoryItemRefPicker (scmHistoryViewPane.ts), in Paseo's modal.
import { useRpc } from "@getpaseo/plugin/client";
import { FlatList, Icon, Loading, Modal, TextInput } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { MAX_REF_QUERY_LENGTH, MAX_SELECTED_REFS, refsRpc } from "../shared/git";
import type { Scope } from "../shared/git";
import * as codicon from "./codicons";
import { key } from "./git";
import { Choice, HostProvider, Notice, PanelRoot, T, toggle, useHint, useHost, useRowHover } from "./ui";

const TITLE = "History Item Reference Picker";
const SEARCH = "Select one/more history item references to view, type to filter";
const name = (id: string) => id.replace(/^refs\/(heads|remotes|tags)\//, "");
const category = (id: string) => (id.startsWith("refs/heads/") ? "branches" : id.startsWith("refs/remotes/") ? "remote branches" : "tags");
const icons = { branches: codicon.gitBranch, "remote branches": codicon.cloud, tags: codicon.tag };
const modes = { all: { label: "All", description: "All history item references" }, current: { label: "Auto", description: "Current history item reference(s)" } };

interface Props {
  cwd: string;
  scope: Scope;
  onScope: (scope: Scope) => void;
}

export function ReferencePicker({ cwd, scope, onScope, autoHint }: Props & { autoHint: string }) {
  const { c, small } = useHost();
  const [open, setOpen] = useState(false);
  const label = Array.isArray(scope) ? (scope.length === 1 ? name(scope[0]) : `${scope.length} Items`) : modes[scope].label;
  const hint = Array.isArray(scope) ? scope.map(name).join(", ") : scope === "all" ? modes.all.description : autoHint || modes.current.description;
  return (
    <>
      <Pressable
        {...useHint(hint)}
        accessibilityRole="button"
        accessibilityLabel={`${TITLE}: ${label}`}
        aria-expanded={open}
        onPress={() => setOpen(true)}
        hitSlop={4}
        style={{ flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 4, maxWidth: "32%" }}
      >
        <Icon icon={codicon.gitBranch} size={small + 3} color={c.foregroundMuted} />
        <T lines={1} size={small} color={c.foregroundMuted} style={{ flexShrink: 1 }}>
          {label}
        </T>
      </Pressable>
      {open && <Picker cwd={cwd} scope={scope} onScope={onScope} close={() => setOpen(false)} />}
    </>
  );
}

function Picker({ cwd, scope, onScope, close }: Props & { close: () => void }) {
  const { c, text, compact, host } = useHost();
  const [draft, setDraft] = useState(scope);
  const [search, setSearch] = useState("");
  const query = search.trim();
  // Don't start a Git process for each keystroke while a name is being typed.
  const [settled, setSettled] = useState(query);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(query), 150);
    return () => clearTimeout(timer);
  }, [query]);
  const read = useRpc(refsRpc);
  const found = useQuery({ queryKey: key("refs", cwd, query), queryFn: () => read({ cwd, query }), enabled: settled === query, retry: false });
  const matches = (label: string) => label.toLowerCase().includes(query.toLowerCase());
  // VS Code puts the saved selection first. Keep it available even when outside the first page of matches.
  const pinned = Array.isArray(scope) ? scope.filter((id) => matches(name(id))) : [];
  const refs = (found.data?.refs ?? []).filter((id) => !pinned.includes(id));
  const ids = [...(["all", "current"] as const).filter((id) => matches(modes[id].label)), ...pinned, ...refs];
  const group = (id: string) => (id === "all" || id === "current" || pinned.includes(id) ? "" : category(id));
  const accept = () => {
    if (!Array.isArray(draft) || draft.length) onScope(draft);
    close();
  };
  const full = Array.isArray(draft) && draft.length >= MAX_SELECTED_REFS;
  const select = (id: string) => {
    if (id === "all" || id === "current") setDraft(draft === id ? [] : id);
    else setDraft(toggle(Array.isArray(draft) ? draft : [], id));
  };
  return (
    <Modal title={TITLE} open onOpenChange={(open) => !open && close()}>
      <Modal.Content scrollable={false} contentContainerStyle={{ flex: 1, padding: 0, gap: 0 }}>
        <HostProvider value={host}>
          <PanelRoot>
            <View style={{ flex: 1, padding: 12, gap: 8 }}>
              <TextInput
                maxLength={MAX_REF_QUERY_LENGTH}
                autoFocus={!compact}
                autoCapitalize="none"
                autoCorrect={false}
                value={search}
                onChangeText={setSearch}
                accessibilityLabel={SEARCH}
                placeholder={SEARCH}
                placeholderTextColor={c.foregroundMuted}
                returnKeyType="done"
                onSubmitEditing={accept}
                style={{ color: c.foreground, backgroundColor: c.surface1, borderColor: c.border, borderWidth: 1, borderRadius: 4, padding: 8, fontSize: text }}
              />
              <FlatList
                style={{ flex: 1 }}
                keyboardShouldPersistTaps="handled"
                data={ids}
                keyExtractor={(id) => id}
                renderItem={({ item, index }) => {
                  const section = group(item);
                  const checked = Array.isArray(draft) ? draft.includes(item) : draft === item;
                  return (
                    <>
                      {section && section !== (index ? group(ids[index - 1]) : "") ? (
                        <T weight="600" color={c.foregroundMuted} style={{ marginTop: 8 }}>
                          {section}
                        </T>
                      ) : null}
                      <Option id={item} checked={checked} disabled={full && !checked && item.startsWith("refs/")} select={() => select(item)} />
                    </>
                  );
                }}
                ListFooterComponent={
                  found.error ? (
                    <Notice failed>{found.error.message}</Notice>
                  ) : !found.data ? (
                    <Loading />
                  ) : found.data.more ? (
                    <Notice>Type to narrow the results.</Notice>
                  ) : !ids.length ? (
                    <Notice>No matching results.</Notice>
                  ) : null
                }
              />
              {full && <Notice>{`Up to ${MAX_SELECTED_REFS} references can be selected.`}</Notice>}
              <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
                <Choice label="Cancel" onPress={close} />
                <Choice label="OK" onPress={accept} />
              </View>
            </View>
          </PanelRoot>
        </HostProvider>
      </Modal.Content>
    </Modal>
  );
}

function Option({ id, checked, disabled, select }: { id: string; checked: boolean; disabled: boolean; select: () => void }) {
  const { c, row, small, platform } = useHost();
  const hover = useRowHover();
  const mode = id === "all" || id === "current" ? modes[id] : null;
  const label = mode?.label ?? name(id);
  const hint = mode?.description ?? id;
  return (
    <Pressable
      {...useHint(hint)}
      accessibilityRole="checkbox"
      accessibilityLabel={mode ? label : id}
      aria-checked={checked}
      aria-disabled={disabled}
      // React Native Web handles Enter, but only handles Space on buttons, not checkbox rows.
      {...(platform === "web" && {
        onKeyDown: (event: { key: string; repeat: boolean; preventDefault(): void }) => {
          if (event.key === " ") {
            event.preventDefault();
            if (!event.repeat && !disabled) select();
          }
        },
      })}
      onPress={disabled ? undefined : select}
      style={(state) => [{ minHeight: row + 4, flexDirection: "row", alignItems: "center", gap: 6, opacity: disabled ? 0.5 : 1 }, hover(state)]}
    >
      <View style={{ width: 16, height: 16, alignItems: "center", justifyContent: "center", borderWidth: 1, borderRadius: 3, borderColor: c.border }}>
        {checked && <Icon icon={codicon.check} size={14} color={c.foreground} />}
      </View>
      {!mode && <Icon icon={icons[category(id)]} size={small + 3} color={c.foregroundMuted} />}
      <T lines={1} style={{ flexShrink: 1 }}>
        {label}
      </T>
      {mode && (
        <T size={small} color={c.foregroundMuted} lines={1} style={{ flexShrink: 1 }}>
          {mode.description}
        </T>
      )}
    </Pressable>
  );
}
