// The working tree: the commit box, and the files that are staged, changed or in conflict.

import { Icon, Modal } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import type { ReactNode } from "react";
import { Pressable, TextInput, View } from "react-native";
import { commitRpc, discardRpc, stageRpc, unstageRpc } from "../shared/git";
import type { DiffSource, FileChange, Status } from "../shared/git";
import { showDiff } from "./diffTab";
import { useCommand } from "./git";
import { FileRow, IconButton, T, useHost } from "./ui";

const drafts = new Map<string, string>(); // repository → the message being written; outlives the panel, not the app

/** Something that cannot be undone, waiting for a yes. */
interface Question {
  title: string;
  text: string;
  yes: string;
  run: () => void;
}

interface Props {
  cwd: string;
  workspaceId: string;
  status: Status;
  folded: string[];
  onFold: (group: string) => void;
}

export function Changes({ cwd, workspaceId, status, folded, onFold }: Props) {
  const { c, text, small } = useHost();
  const stage = useCommand(stageRpc, cwd);
  const unstage = useCommand(unstageRpc, cwd);
  const discard = useCommand(discardRpc, cwd);
  const commit = useCommand(commitRpc, cwd);
  const [message, setMessage] = useState(() => drafts.get(cwd) ?? "");
  const [question, ask] = useState<Question | null>(null);
  const write = (next: string) => {
    drafts.set(cwd, next);
    setMessage(next);
  };
  const where = status.branch ?? `${status.head?.slice(0, 7)} (detached)`;
  const written = message.trim() !== "";
  const staged = status.staged.length > 0;
  const send = (amend: boolean) => commit.mutate({ message, amend }, { onSuccess: () => write("") });
  const pushed = status.upstream !== null && status.ahead === 0; // the last commit is already on the upstream
  const amend = () =>
    pushed
      ? ask({
          title: "Amend a pushed commit?",
          text: `The last commit is already on ${status.upstream}. Amending replaces it here, and the branch can then only be pushed by force.`,
          yes: "Amend",
          run: () => send(true),
        })
      : send(true);
  const drop = (file: FileChange) =>
    ask(
      file.status === "?"
        ? { title: "Delete file?", text: `${file.path} is untracked. It will be deleted.`, yes: "Delete", run: () => discard.mutate({ files: [file] }) }
        : { title: "Discard changes?", text: `The changes in ${file.path} will be lost.`, yes: "Discard", run: () => discard.mutate({ files: [file] }) },
    );
  const group = (title: string, files: FileChange[], source: DiffSource, all: ReactNode, each: (file: FileChange) => ReactNode) => (
    <Group title={title} files={files} folded={folded.includes(title)} onFold={() => onFold(title)} onOpen={(file) => showDiff({ workspaceId, cwd, source, file })} all={all} each={each} />
  );
  return (
    <View>
      <View style={{ padding: 8, gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Icon name="GitBranch" size={text + 1} color={c.foregroundMuted} />
          <T weight="600" lines={1} style={{ flexShrink: 1, minWidth: 0 }}>
            {where}
          </T>
          {status.upstream !== null && (
            <T size={small} color={c.foregroundMuted} lines={1} style={{ flexShrink: 1000, minWidth: 0 }}>
              {status.upstream + (status.ahead || status.behind ? `  ↑${status.ahead} ↓${status.behind}` : "")}
            </T>
          )}
        </View>
        <TextInput
          accessibilityLabel="Commit message"
          multiline
          value={message}
          onChangeText={write}
          placeholder={`Message (commit on "${where}")`}
          placeholderTextColor={c.foregroundMuted}
          style={{ minHeight: 56, padding: 6, borderWidth: 1, borderRadius: 4, borderColor: c.border, backgroundColor: c.surface2, color: c.foreground, fontSize: text, textAlignVertical: "top" }}
        />
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Action label="Commit" icon="Check" primary enabled={written && staged && !commit.isPending} onPress={() => send(false)} />
          {/* Folds what is staged into the last commit; a message, if one is written, replaces that commit's own. */}
          <Action label="Amend" hint="Amend the last commit" enabled={status.head !== null && (written || staged) && !commit.isPending} onPress={amend} />
        </View>
      </View>
      {group("Merge Changes", status.conflicts, { kind: "changes" }, null, (file) => (
        <IconButton name="Plus" label={`Mark ${file.path} as resolved`} onPress={() => stage.mutate({ files: [file] })} />
      ))}
      {group(
        "Staged Changes",
        status.staged,
        { kind: "staged" },
        <IconButton name="Minus" label="Unstage all changes" onPress={() => unstage.mutate({ files: status.staged })} />,
        (file) => (
          <IconButton name="Minus" label={`Unstage ${file.path}`} onPress={() => unstage.mutate({ files: [file] })} />
        ),
      )}
      {group(
        "Changes",
        status.changes,
        { kind: "changes" },
        <IconButton name="Plus" label="Stage all changes" onPress={() => stage.mutate({ files: status.changes })} />,
        (file) => (
          <>
            <IconButton name="Undo2" label={`Discard changes in ${file.path}`} onPress={() => drop(file)} />
            <IconButton name="Plus" label={`Stage ${file.path}`} onPress={() => stage.mutate({ files: [file] })} />
          </>
        ),
      )}
      <Modal title={question?.title ?? ""} open={question !== null} onOpenChange={(open) => !open && ask(null)}>
        <Modal.Content>
          {question && (
            <>
              <T>{question.text}</T>
              <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
                <Choice label="Cancel" onPress={() => ask(null)} />
                <Choice
                  label={question.yes}
                  danger
                  onPress={() => {
                    question.run();
                    ask(null);
                  }}
                />
              </View>
            </>
          )}
        </Modal.Content>
      </Modal>
    </View>
  );
}

/** One of the buttons under the commit box. */
function Action({ label, hint, icon, primary, enabled, onPress }: { label: string; hint?: string; icon?: string; primary?: boolean; enabled: boolean; onPress: () => void }) {
  const { c, text } = useHost();
  const ink = primary ? c.accentForeground : c.foreground;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={hint ?? label}
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      onPress={onPress}
      style={[
        { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 4, borderWidth: 1, opacity: enabled ? 1 : 0.5 },
        primary ? { flex: 1, backgroundColor: c.accent, borderColor: c.accent } : { backgroundColor: c.surface2, borderColor: c.border },
      ]}
    >
      {icon && <Icon name={icon} size={text + 1} color={ink} />}
      <T weight="600" color={ink}>
        {label}
      </T>
    </Pressable>
  );
}

interface GroupProps {
  title: string;
  files: FileChange[];
  folded: boolean;
  onFold: () => void;
  onOpen: (file: FileChange) => void;
  all: ReactNode; // an action on the whole group
  each: (file: FileChange) => ReactNode; // the actions on one file
}

/** A titled list of files. An empty group is not shown at all. */
function Group({ title, files, folded, onFold, onOpen, all, each }: GroupProps) {
  const { c, row, small } = useHost();
  if (!files.length) return null;
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: !folded }}
        onPress={onFold}
        style={{ flexDirection: "row", alignItems: "center", gap: 4, height: row, paddingHorizontal: 8 }}
      >
        <Icon name={folded ? "ChevronRight" : "ChevronDown"} size={small + 3} color={c.foregroundMuted} />
        <T size={small} weight="600" color={c.foregroundMuted} lines={1} style={{ flex: 1, minWidth: 0, textTransform: "uppercase" }}>
          {title}
        </T>
        {all}
        <T size={small} color={c.foregroundMuted} style={{ minWidth: 12, textAlign: "center" }}>
          {String(files.length)}
        </T>
      </Pressable>
      {!folded && files.map((file) => <FileRow key={file.path} file={file} indent={27} onPress={() => onOpen(file)} actions={each(file)} />)}
    </View>
  );
}

function Choice({ label, onPress, danger }: { label: string; onPress: () => void; danger?: boolean }) {
  const { c } = useHost();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={{ paddingVertical: 6, paddingHorizontal: 14, borderRadius: 4, borderWidth: 1, borderColor: danger ? c.statusDanger : c.border }}>
      <T weight="600" color={danger ? c.statusDanger : c.foreground}>
        {label}
      </T>
    </Pressable>
  );
}
