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
  const [doomed, setDoomed] = useState<FileChange | null>(null); // waits for a yes before it is discarded
  const write = (next: string) => {
    drafts.set(cwd, next);
    setMessage(next);
  };
  const where = status.branch ?? `${status.head?.slice(0, 7)} (detached)`;
  const ready = message.trim() !== "" && status.staged.length > 0 && !commit.isPending;
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
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !ready }}
          disabled={!ready}
          onPress={() => commit.mutate({ message }, { onSuccess: () => write("") })}
          style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 6, borderRadius: 4, backgroundColor: c.accent, opacity: ready ? 1 : 0.5 }}
        >
          <Icon name="Check" size={text + 1} color={c.accentForeground} />
          <T weight="600" color={c.accentForeground}>
            Commit
          </T>
        </Pressable>
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
            <IconButton name="Undo2" label={`Discard changes in ${file.path}`} onPress={() => setDoomed(file)} />
            <IconButton name="Plus" label={`Stage ${file.path}`} onPress={() => stage.mutate({ files: [file] })} />
          </>
        ),
      )}
      <Modal title={doomed?.status === "?" ? "Delete file?" : "Discard changes?"} open={doomed !== null} onOpenChange={(open) => !open && setDoomed(null)}>
        <Modal.Content>
          {doomed && (
            <>
              <T>{doomed.status === "?" ? `${doomed.path} is untracked. It will be deleted.` : `The changes in ${doomed.path} will be lost.`}</T>
              <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
                <Choice label="Cancel" onPress={() => setDoomed(null)} />
                <Choice
                  label={doomed.status === "?" ? "Delete" : "Discard"}
                  danger
                  onPress={() => {
                    discard.mutate({ files: [doomed] });
                    setDoomed(null);
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
