// The working tree: the commit box, and the files that are staged, changed or in conflict.

import { Icon, Modal } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import type { ReactNode } from "react";
import { Pressable, TextInput, View } from "react-native";
import { commitRpc, discardRpc, stageRpc, unstageRpc } from "../shared/git";
import type { DiffSource, FileChange, Status } from "../shared/git";
import * as codicon from "./codicons";
import { showDiff } from "./diffTab";
import { FileTree } from "./Files";
import { useCommand } from "./git";
import { Heading, IconButton, T, useHint, useHost, useMenu } from "./ui";
import type { MenuItem } from "./ui";

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
  const { c, text } = useHost();
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
  const canCommit = written && staged && !commit.isPending;
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
  /** Discards one file, or everything in a folder: `path` is the row that was asked about. */
  const drop = (files: FileChange[], path: string) => {
    const untracked = files.filter((file) => file.status === "?").length;
    const changed = files.length - untracked;
    const count = (n: number, what: string) => `${n} ${what}${n === 1 ? "" : "s"}`;
    const text =
      files.length === 1
        ? untracked
          ? `${files[0].path} is untracked. It will be deleted.`
          : `The changes in ${files[0].path} will be lost.`
        : `In ${path}, ${[changed && `the changes in ${count(changed, "file")} will be lost`, untracked && `${count(untracked, "untracked file")} will be deleted`].filter(Boolean).join(" and ")}.`;
    ask({ title: changed ? "Discard changes?" : files.length === 1 ? "Delete file?" : "Delete files?", text, yes: changed ? "Discard" : "Delete", run: () => discard.mutate({ files }) });
  };
  const group = (title: string, files: FileChange[], source: DiffSource, all: ReactNode, each: (files: FileChange[], path: string) => ReactNode) => (
    <Group title={title} files={files} folded={folded.includes(title)} onFold={() => onFold(title)} onOpen={(file) => showDiff({ workspaceId, cwd, source, file })} all={all} each={each} />
  );
  return (
    <View>
      <View style={{ padding: 8, gap: 8 }}>
        <TextInput
          accessibilityLabel="Commit message"
          multiline
          value={message}
          onChangeText={write}
          placeholder={`Message (commit on "${where}")`}
          placeholderTextColor={c.foregroundMuted}
          style={{ minHeight: 56, padding: 6, borderWidth: 1, borderRadius: 4, borderColor: c.border, backgroundColor: c.surface2, color: c.foreground, fontSize: text, textAlignVertical: "top" }}
        />
        <CommitButton
          enabled={canCommit}
          onCommit={() => send(false)}
          more={[
            { label: "Commit", enabled: canCommit, onPress: () => send(false) },
            // Folds what is staged into the last commit; a message, if one is written, replaces that commit's own.
            { label: "Commit (Amend)", enabled: status.head !== null && (written || staged) && !commit.isPending, onPress: amend },
          ]}
        />
      </View>
      {group("Merge Changes", status.conflicts, { kind: "changes" }, null, (files, path) => (
        <IconButton icon={codicon.add} label={`Mark ${path} as resolved`} hint="Mark as resolved" onPress={() => stage.mutate({ files })} />
      ))}
      {group(
        "Staged Changes",
        status.staged,
        { kind: "staged" },
        <IconButton icon={codicon.remove} label="Unstage all changes" onPress={() => unstage.mutate({ files: status.staged })} />,
        (files, path) => (
          <IconButton icon={codicon.remove} label={`Unstage ${path}`} hint="Unstage changes" onPress={() => unstage.mutate({ files })} />
        ),
      )}
      {group(
        "Changes",
        status.changes,
        { kind: "changes" },
        <IconButton icon={codicon.add} label="Stage all changes" onPress={() => stage.mutate({ files: status.changes })} />,
        (files, path) => (
          <>
            <IconButton icon={codicon.discard} label={`Discard changes in ${path}`} hint="Discard changes" onPress={() => drop(files, path)} />
            <IconButton icon={codicon.add} label={`Stage ${path}`} hint="Stage changes" onPress={() => stage.mutate({ files })} />
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

/** The button under the commit box, as VS Code splits it: the commit itself, and an arrow that opens the other ways to commit. */
function CommitButton({ enabled, onCommit, more }: { enabled: boolean; onCommit: () => void; more: MenuItem[] }) {
  const { c, text } = useHost();
  const menu = useMenu();
  const arrow = useHint("More actions");
  return (
    <View style={{ flexDirection: "row", borderRadius: 4, overflow: "hidden", backgroundColor: c.accent }}>
      <Pressable
        {...useHint("Commit the staged changes")}
        accessibilityRole="button"
        accessibilityLabel="Commit"
        accessibilityState={{ disabled: !enabled }}
        onPress={enabled ? onCommit : undefined} // not the disabled prop: that would switch off hovering, and the hint with it
        style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 6, opacity: enabled ? 1 : 0.5 }}
      >
        <Icon icon={codicon.check} size={text + 3} color={c.accentForeground} />
        <T weight="600" color={c.accentForeground}>
          Commit
        </T>
      </Pressable>
      <View style={{ width: 1, marginVertical: 5, backgroundColor: c.accentForeground, opacity: 0.4 }} />
      <Pressable
        {...arrow}
        accessibilityRole="button"
        accessibilityLabel="More commit actions"
        onPress={() => arrow.ref.current && menu(arrow.ref.current, more)}
        style={{ justifyContent: "center", paddingHorizontal: 8 }}
      >
        <Icon icon={codicon.chevronDown} size={text + 3} color={c.accentForeground} />
      </Pressable>
    </View>
  );
}

interface GroupProps {
  title: string;
  files: FileChange[];
  folded: boolean;
  onFold: () => void;
  onOpen: (file: FileChange) => void;
  all: ReactNode; // an action on the whole group
  each: (files: FileChange[], path: string) => ReactNode; // the actions on one row: a file, or the files in a folder
}

/** A titled tree of files. An empty group is not shown at all. */
function Group({ title, files, folded, onFold, onOpen, all, each }: GroupProps) {
  if (!files.length) return null;
  return (
    <View>
      <Heading title={title} folded={folded} onFold={onFold} count={files.length}>
        {all}
      </Heading>
      {!folded && <FileTree files={files} indent={20} onOpen={onOpen} actions={each} />}
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
