// The working tree: the commit box, and the files that are staged, changed or in conflict. While the
// files scroll, the title of their group and the folders they are in stay at the top, as in VS Code.

import { Icon, Modal } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import type { ReactNode } from "react";
import { Pressable, TextInput, View } from "react-native";
import { commitRpc, discardRpc, stageRpc, unstageRpc } from "../shared/git";
import type { DiffSource, FileChange, Status } from "../shared/git";
import * as codicon from "./codicons";
import { showDiff } from "./diffTab";
import { fileRows } from "./Files";
import { useCommand } from "./git";
import { useOpenFile } from "./openFile";
import type { Row } from "./sticky";
import { StickyList } from "./StickyList";
import { Heading, IconButton, T, toggle, useHint, useHost, useMenu } from "./ui";
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
  folded: string[]; // a group is folded when "group:<title>" is in it
  onFold: (key: string) => void;
}

export function Changes({ cwd, workspaceId, status, folded, onFold }: Props) {
  const { c, text } = useHost();
  const stage = useCommand(stageRpc, cwd);
  const unstage = useCommand(unstageRpc, cwd);
  const discard = useCommand(discardRpc, cwd);
  const commit = useCommand(commitRpc, cwd);
  const [message, setMessage] = useState(() => drafts.get(cwd) ?? "");
  const [question, ask] = useState<Question | null>(null);
  const [shut, setShut] = useState<Record<string, string[]>>({}); // a group's title → the paths of its folded folders
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
  const openFile = useOpenFile();
  /** VS Code's Open File, on a file that is there to open. */
  const opener = (file: FileChange | null) =>
    openFile && file && file.status !== "D" && <IconButton icon={codicon.goToFile} label={`Open ${file.path}`} hint="Open File" onPress={() => openFile(`${cwd}/${file.path}`)} />;
  /**
   * A group's title and its files as a tree of folders, `all` being the action on the whole group and `each` the
   * actions on one row: a file, or the files in a folder. An empty group is not shown at all.
   */
  const group = (title: string, files: FileChange[], source: DiffSource, all: ReactNode, each: (files: FileChange[], path: string, file: FileChange | null) => ReactNode): Row[] => {
    if (!files.length) return [];
    const key = `group:${title}`;
    const open = !folded.includes(key);
    const inner = open
      ? fileRows({
          files,
          indent: 20,
          depth: 1,
          folded: shut[title] ?? [],
          onFold: (path) => setShut({ ...shut, [title]: toggle(shut[title] ?? [], path) }),
          onOpen: (file) => showDiff({ workspaceId, cwd, source, file }),
          actions: each,
        })
      : [];
    const heading = (onPress: () => void) => (
      <Heading title={title} folded={!open} onFold={onPress} count={files.length} group>
        {all}
      </Heading>
    );
    // A folder or file can be in more than one group: its rows are told apart by the group's key.
    return [{ key, depth: 0, inside: inner.length, onPress: () => onFold(key), render: heading }, ...inner.map((row) => ({ ...row, key: `${key}/${row.key}` }))];
  };
  const head = (
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
  );
  const rows = [
    ...group("Merge Changes", status.conflicts, { kind: "changes" }, null, (files, path, file) => (
      <>
        {opener(file)}
        <IconButton icon={codicon.add} label={`Mark ${path} as resolved`} hint="Mark as resolved" onPress={() => stage.mutate({ files })} />
      </>
    )),
    ...group(
      "Staged Changes",
      status.staged,
      { kind: "staged" },
      <IconButton icon={codicon.remove} label="Unstage all changes" onPress={() => unstage.mutate({ files: status.staged })} />,
      (files, path, file) => (
        <>
          {opener(file)}
          <IconButton icon={codicon.remove} label={`Unstage ${path}`} hint="Unstage changes" onPress={() => unstage.mutate({ files })} />
        </>
      ),
    ),
    ...group(
      "Changes",
      status.changes,
      { kind: "changes" },
      <IconButton icon={codicon.add} label="Stage all changes" onPress={() => stage.mutate({ files: status.changes })} />,
      (files, path, file) => (
        <>
          {opener(file)}
          <IconButton icon={codicon.discard} label={`Discard changes in ${path}`} hint="Discard changes" onPress={() => drop(files, path)} />
          <IconButton icon={codicon.add} label={`Stage ${path}`} hint="Stage changes" onPress={() => stage.mutate({ files })} />
        </>
      ),
    ),
  ];
  return (
    <>
      <StickyList head={head} rows={rows} />
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
    </>
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
