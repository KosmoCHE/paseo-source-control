// The workspace's repositories. One is selected, and the rest of the panel shows that one.

import { Icon } from "@getpaseo/plugin/client/ui";
import { Pressable, ScrollView, View } from "react-native";
import type { Repository } from "../shared/git";
import * as codicon from "./codicons";
import { T, Tint, useHost } from "./ui";

interface Props {
  list: Repository[];
  selected: Repository;
  folded: boolean; // folded, only the selected repository shows
  onSelect: (root: string) => void;
}

export function Repositories({ list, selected, folded, onSelect }: Props) {
  const { c, row, small } = useHost();
  return (
    <ScrollView>
      {(folded ? [selected] : list).map((repository) => {
        const chosen = repository === selected;
        return (
          <Pressable
            key={repository.root}
            accessibilityRole="button"
            accessibilityLabel={`Repository ${repository.name}`}
            accessibilityState={{ selected: chosen }}
            onPress={() => onSelect(repository.root)}
            style={{ flexDirection: "row", alignItems: "center", gap: 6, height: row, paddingLeft: 27, paddingRight: 8 }}
          >
            {chosen && <Tint color={c.accent} opacity={0.14} />}
            {/* As in VS Code, the selected repository is ticked once there is more than one to choose from. */}
            <Icon icon={chosen && list.length > 1 ? codicon.repoSelected : codicon.repo} size={small + 5} color={c.foregroundMuted} />
            <T lines={1} weight={chosen ? "600" : undefined} style={{ flex: 1, minWidth: 0 }}>
              {repository.name}
            </T>
            {repository.failed !== null ? (
              // Selected, the repository says it in full where its changes would be.
              <T size={small} color={c.statusDanger} lines={1} style={{ flexShrink: 1, minWidth: 0, maxWidth: "60%" }}>
                {repository.failed}
              </T>
            ) : (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 3, flexShrink: 0, maxWidth: "60%" }}>
                <Icon icon={branchIcon(repository)} size={small + 2} color={c.foregroundMuted} />
                <T size={small} color={c.foregroundMuted} lines={1} style={{ flexShrink: 1, minWidth: 0 }}>
                  {branchLabel(repository)}
                </T>
                {/* What a pull would bring and a push would send, as VS Code counts them beside the branch. */}
                {(repository.ahead > 0 || repository.behind > 0) && <T size={small} color={c.foregroundMuted}>{` ${repository.behind}↓ ${repository.ahead}↑`}</T>}
              </View>
            )}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** The branch's name as VS Code shows it beside a repository: "*" for changed files, "+" for staged ones, "!" for a merge or rebase under way. */
function branchLabel({ branch, head, changed, staged, merging }: Repository) {
  return (branch ?? head?.slice(0, 8)) + (changed ? "*" : "") + (staged ? "+" : "") + (merging ? "!" : "");
}

/** VS Code's icon for the same: the most pressing of those, or the commit when no branch is checked out. */
function branchIcon({ branch, changed, staged, merging }: Repository) {
  if (branch === null) return codicon.gitCommit;
  if (merging) return codicon.gitBranchConflicts;
  if (staged) return codicon.gitBranchStagedChanges;
  if (changed) return codicon.gitBranchChanges;
  return codicon.gitBranch;
}
