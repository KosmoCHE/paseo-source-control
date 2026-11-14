// Changed files as a tree of folders. A folder folds, and its actions apply to everything in it.

import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import type { FileChange } from "../shared/git";
import * as codicon from "./codicons";
import { everyFile, fileName, tree } from "./tree";
import type { Folder } from "./tree";
import { T, useHost } from "./ui";

const STEP = 12; // how far each level is set in

/** The letter and colour VS Code gives a file's state. */
function mark(status: string, c: PluginTheme["colors"]) {
  if (status === "?") return { letter: "U", color: c.statusSuccess };
  if (status === "A") return { letter: "A", color: c.statusSuccess };
  if (status === "D") return { letter: "D", color: c.statusDanger };
  if (status === "U") return { letter: "!", color: c.statusDanger };
  if (status === "R" || status === "C") return { letter: status, color: c.accent };
  return { letter: "M", color: c.statusWarning };
}

interface Props {
  files: FileChange[];
  indent: number; // where the top level starts
  onOpen: (file: FileChange) => void;
  /** The buttons of one row: for a file, or for everything in a folder. `path` names the row, `file` is the row's file, null for a folder's. */
  actions?: (files: FileChange[], path: string, file: FileChange | null) => ReactNode;
}

export function FileTree({ files, indent, onOpen, actions }: Props) {
  const { c, row, small } = useHost();
  const root = useMemo(() => tree(files), [files]);
  const [folded, setFolded] = useState<string[]>([]); // by folder path
  const line = { flexDirection: "row", alignItems: "center", height: row, paddingRight: 8, gap: 5 } as const;

  const rows = (folder: Folder, depth: number): ReactNode[] => [
    ...folder.folders.flatMap((child) => {
      const shut = folded.includes(child.path);
      const inside = everyFile(child);
      return [
        <Pressable
          key={"folder:" + child.path}
          accessibilityRole="button"
          accessibilityLabel={`Folder ${child.path}`}
          accessibilityState={{ expanded: !shut }}
          onPress={() => setFolded(shut ? folded.filter((path) => path !== child.path) : [...folded, child.path])}
          style={[line, { paddingLeft: indent + depth * STEP }]}
        >
          <Icon icon={shut ? codicon.chevronRight : codicon.chevronDown} size={small + 5} color={c.foregroundMuted} />
          <Icon icon={shut ? codicon.folder : codicon.folderOpened} size={small + 5} color={c.foregroundMuted} />
          <T lines={1} style={{ flex: 1, minWidth: 0 }}>
            {child.name.replaceAll("/", " / ")}
          </T>
          {actions?.(inside, child.path, null)}
          {/* A dot for "something in here changed", in the colour of the most pressing change. */}
          <View style={{ width: 12, alignItems: "center" }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: inside.some((file) => file.status === "U") ? c.statusDanger : inside.every((file) => "A?".includes(file.status)) ? c.statusSuccess : c.statusWarning }} />
          </View>
        </Pressable>,
        ...(shut ? [] : rows(child, depth + 1)),
      ];
    }),
    ...folder.files.map((file) => {
      const { letter, color } = mark(file.status, c);
      return (
        <Pressable
          key={"file:" + file.path}
          accessibilityRole="button"
          accessibilityLabel={`${file.path}, ${letter}`}
          onPress={() => onOpen(file)}
          // A file lines up with the names of the folders beside it, past their chevrons.
          style={[line, { paddingLeft: indent + depth * STEP + small + 5 + line.gap }]}
        >
          <Icon icon={codicon.file} size={small + 5} color={c.foregroundMuted} />
          <T lines={1} style={[{ flexShrink: 1, minWidth: 0 }, file.status === "D" && { textDecorationLine: "line-through" }]}>
            {fileName(file)}
          </T>
          <T size={small} color={c.foregroundMuted} lines={1} style={{ flex: 1, flexShrink: 1000, minWidth: 0 }}>
            {file.from ? `← ${file.from}` : ""}
          </T>
          {actions?.([file], file.path, file)}
          <T size={small} weight="600" color={color} style={{ width: 12, textAlign: "center" }}>
            {letter}
          </T>
        </Pressable>
      );
    }),
  ];
  return <View>{rows(root, 0)}</View>;
}
