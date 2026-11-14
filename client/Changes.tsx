// The working tree: the commit box, and the files that are staged, changed or in conflict. While the
// files scroll, the title of their group and the folders they are in stay at the top, as in VS Code.

import { Icon, Modal, useToast } from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Pressable, TextInput, View } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import { commitRpc, discardRpc, ignoreRpc, markersRpc, removeRpc, stageRpc, unstageRpc } from "../shared/git";
import type { DiffSource, FileChange, Status } from "../shared/git";
import * as codicon from "./codicons";
import { showDiff } from "./diffTab";
import { fileRows } from "./Files";
import { useCommand, useSteps } from "./git";
import { useOpenFile } from "./openFile";
import type { Row } from "./sticky";
import { StickyList } from "./StickyList";
import { fileName } from "./tree";
import { Heading, IconButton, T, toggle, useHint, useHost, useMenu } from "./ui";
import type { MenuItem } from "./ui";

const drafts = new Map<string, string>(); // repository → the message being written; outlives the panel, not the app
const warned = new Set<string>(); // repositories told they have too many changes: as in VS Code, once while the app runs

/** One of VS Code's modal dialogs: a choice is answered with its label, Cancel or closing with null. */
interface Question {
  title: string;
  text: string;
  choices: string[];
  danger: boolean; // what is chosen cannot be undone
  answer: (choice: string | null) => void;
}

/** "N files" or, for one, "the file's name", as VS Code words its dialogs. */
const many = (files: FileChange[]) => files.length > 1;
const named = (files: FileChange[]) => fileName(files[0]);

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
  const commit = useCommand(commitRpc, cwd);
  const call = { stage: useRpc(stageRpc), discard: useRpc(discardRpc), remove: useRpc(removeRpc), markers: useRpc(markersRpc) };
  const [message, setMessage] = useState(() => drafts.get(cwd) ?? "");
  const [question, setQuestion] = useState<Question | null>(null);
  const ask = (title: string, text: string, choices: string[], danger = true) => new Promise<string | null>((answer) => setQuestion({ title, text, choices, danger, answer }));
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
  const amend = async () => {
    const text = `The last commit is already on ${status.upstream}. Amending replaces it here, and the branch can then only be pushed by force.`;
    if (!pushed || (await ask("Amend a pushed commit?", text, ["Amend"])) === "Amend") send(true);
  };
  /**
   * VS Code's Discard Changes, asked about in its words: tracked files are restored, untracked ones go to the Trash,
   * and when the Trash cannot take them the question is whether to delete them for good.
   */
  const drop = useSteps(async (files: FileChange[]) => {
    const untracked = files.filter((file) => file.status === "?");
    const tracked = files.filter((file) => file.status !== "?");
    const toTrash = many(untracked)
      ? `Are you sure you want to DELETE the ${untracked.length} untracked files?`
      : `Are you sure you want to DELETE the following untracked file: '${named(untracked.length ? untracked : files)}'?`;
    const fromTrash = many(untracked) ? "You can restore these files from the Trash." : "You can restore this file from the Trash.";
    const lost = "This is IRREVERSIBLE!\nYour current working set will be FOREVER LOST if you proceed.";
    let chosen = files;
    if (!untracked.length) {
      const deleted = tracked.every((file) => file.status === "D");
      const title = deleted
        ? many(tracked)
          ? `Are you sure you want to restore ALL ${tracked.length} files?`
          : `Are you sure you want to restore '${named(tracked)}'?`
        : many(tracked)
          ? `Are you sure you want to discard ALL changes in ${tracked.length} files?`
          : `Are you sure you want to discard changes in '${named(tracked)}'?`;
      const yes = deleted ? (many(tracked) ? `Restore All ${tracked.length} Files` : "Restore File") : many(tracked) ? `Discard All ${tracked.length} Files` : "Discard File";
      if ((await ask(title, !deleted && many(tracked) ? lost : "", [yes])) !== yes) return;
    } else if (!tracked.length) {
      if ((await ask(toTrash, fromTrash, ["Move to Trash"])) !== "Move to Trash") return;
    } else {
      const trackedToo = many(tracked) ? `Are you sure you want to discard ALL changes in ${tracked.length} files?` : `Are you sure you want to discard changes in '${named(tracked)}'?`;
      const yesTracked = many(tracked) ? `Discard All ${tracked.length} Tracked Files` : "Discard 1 Tracked File";
      const yesAll = `Discard All ${files.length} Files`;
      const pick = await ask(toTrash, `${fromTrash}\n\n${trackedToo}\n\n${lost}`, [yesTracked, yesAll]);
      if (pick === yesTracked) chosen = tracked;
      else if (pick !== yesAll) return;
    }
    const { trashFailed } = await call.discard({ cwd, files: chosen, trash: true });
    if (!trashFailed) return;
    const left = chosen.filter((file) => file.status === "?");
    const yes = many(left) ? `Delete All ${left.length} Files` : "Delete File";
    if ((await ask("Failed to delete using the Trash. Do you want to permanently delete instead?", "", [yes])) === yes) await call.discard({ cwd, files: left, trash: false });
  });
  /**
   * VS Code's Stage Changes on files in conflict: it asks first about any that still hold conflict markers, and what to
   * keep of a file deleted on one side.
   */
  const resolve = useSteps(async (files: FileChange[]) => {
    const both = files.filter((file) => file.conflict === "UU" || file.conflict === "AA");
    const deletions = files.filter((file) => file.conflict === "UD" || file.conflict === "DU");
    const marked = both.length ? (await call.markers({ cwd, paths: both.map((file) => file.path) })).paths : [];
    const unresolved = files.filter((file) => !deletions.includes(file) && (!both.includes(file) || marked.includes(file.path)));
    if (unresolved.length) {
      const title = many(unresolved) ? `Are you sure you want to stage ${unresolved.length} files with merge conflicts?` : `Are you sure you want to stage ${named(unresolved)} with merge conflicts?`;
      if ((await ask(title, "", ["Yes"])) !== "Yes") return;
    }
    for (const file of deletions) {
      const ours = file.conflict === "UD"; // deleted by them, changed by us
      const keep = ours ? "Keep Our Version" : "Keep Their Version";
      const title = `File "${fileName(file)}" was deleted by ${ours ? "them and modified by us" : "us and modified by them"}.`;
      const pick = await ask(title, "What would you like to do?", [keep, "Delete File"], false);
      if (pick === null) return;
      await (pick === keep ? call.stage : call.remove)({ cwd, files: [file] });
    }
    const rest = files.filter((file) => !deletions.includes(file));
    if (rest.length) await call.stage({ cwd, files: rest });
  });
  const reply = (asked: Question, choice: string | null) => {
    setQuestion(null);
    asked.answer(choice);
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
          // An untracked file has nothing to be compared with: as in VS Code, it opens as itself, where Paseo can open files.
          onOpen: (file) => (openFile && file.status === "?" ? openFile(`${cwd}/${file.path}`) : showDiff({ workspaceId, cwd, source, file })),
          actions: each,
        })
      : [];
    const heading = (onPress: () => void, onChevron?: () => void) => (
      <Heading title={title} folded={!open} onFold={onPress} onChevron={onChevron} count={files.length} group>
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
      {status.cutAt !== null && <TooMany cwd={cwd} cutAt={status.cutAt} hugeFolders={status.hugeFolders} />}
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
    ...group(
      "Merge Changes",
      status.conflicts,
      { kind: "changes" },
      <IconButton icon={codicon.add} label="Stage All Merge Changes" onPress={() => resolve.mutate(status.conflicts)} />,
      (files, path, file) => (
        <>
          {opener(file)}
          <IconButton icon={codicon.add} label={`Stage ${path}`} hint="Stage Changes" onPress={() => resolve.mutate(files)} />
        </>
      ),
    ),
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
      <>
        <IconButton icon={codicon.discard} label="Discard All Changes" onPress={() => drop.mutate(status.changes)} />
        <IconButton icon={codicon.add} label="Stage All Changes" onPress={() => stage.mutate({ files: status.changes })} />
      </>,
      (files, path, file) => (
        <>
          {opener(file)}
          <IconButton icon={codicon.discard} label={`Discard changes in ${path}`} hint="Discard Changes" onPress={() => drop.mutate(files)} />
          <IconButton icon={codicon.add} label={`Stage ${path}`} hint="Stage changes" onPress={() => stage.mutate({ files })} />
        </>
      ),
    ),
  ];
  return (
    <>
      <StickyList head={head} rows={rows} />
      <Modal title={question?.title ?? ""} open={question !== null} onOpenChange={(open) => !open && question && reply(question, null)}>
        <Modal.Content>
          {question && (
            <>
              {question.text !== "" && <T>{question.text}</T>}
              <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: 8 }}>
                <Choice label="Cancel" onPress={() => reply(question, null)} />
                {question.choices.map((choice) => (
                  <Choice key={choice} label={choice} danger={question.danger} onPress={() => reply(question, choice)} />
                ))}
              </View>
            </>
          )}
        </Modal.Content>
      </Modal>
    </>
  );
}

/**
 * What VS Code says when git status was cut short: a warning under the commit box while it lasts, and a notification
 * once. Where it would offer to add node_modules to .gitignore, the offer is a button here.
 */
function TooMany({ cwd, cutAt, hugeFolders }: { cwd: string; cutAt: number; hugeFolders: string[] }) {
  const { c, small } = useHost();
  const toast = useToast();
  useEffect(() => {
    if (warned.has(cwd)) return;
    warned.add(cwd);
    toast.show(`The git repository at "${cwd}" has too many active changes, only a subset of Git features will be enabled.`, { variant: "warning" });
  }, [cwd]);
  return (
    <View style={{ gap: 4, padding: 6, borderWidth: 1, borderRadius: 4, borderColor: c.statusWarning }}>
      <T size={small}>{`Too many changes were detected. Only the first ${cutAt} changes will be shown below.`}</T>
      {hugeFolders.map((folder) => (
        <IgnoreFolder key={folder} cwd={cwd} folder={folder} />
      ))}
    </View>
  );
}

function IgnoreFolder({ cwd, folder }: { cwd: string; folder: string }) {
  const { c, small } = useHost();
  const ignore = useCommand(ignoreRpc, cwd);
  return (
    <Pressable
      {...useHint(`Add "${folder}" to the .gitignore at the repository's root`)}
      accessibilityRole="button"
      onPress={ignore.isPending ? undefined : () => ignore.mutate({ paths: [folder] })}
      style={{ alignSelf: "flex-start" }}
    >
      <T size={small} color={c.accent}>{`Add "${folder}" to .gitignore`}</T>
    </Pressable>
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
