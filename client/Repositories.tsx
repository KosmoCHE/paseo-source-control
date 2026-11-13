// The workspace's repositories. One is selected, and the rest of the panel shows that one.

import { Icon } from "@getpaseo/plugin/client/ui";
import { Pressable, View } from "react-native";
import type { Repository } from "../shared/git";
import { branch, repository as repositoryIcon } from "./codicons";
import { Heading, T, Tint, useHost } from "./ui";

interface Props {
  list: Repository[];
  selected: Repository;
  folded: boolean; // folded, only the selected repository shows
  onFold: () => void;
  onSelect: (root: string) => void;
}

export function Repositories({ list, selected, folded, onFold, onSelect }: Props) {
  const { c, row, small } = useHost();
  return (
    <View>
      <Heading title="Repositories" folded={folded} onFold={onFold} count={list.length} />
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
            <Icon icon={repositoryIcon} size={small + 3} color={c.foregroundMuted} />
            <T lines={1} weight={chosen ? "600" : undefined} style={{ flex: 1, minWidth: 0 }}>
              {repository.name}
            </T>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 3, flexShrink: 0, maxWidth: "60%" }}>
              <Icon icon={branch} size={small + 1} color={c.foregroundMuted} />
              <T size={small} color={c.foregroundMuted} lines={1} style={{ flexShrink: 1, minWidth: 0 }}>
                {repository.branch ?? "detached"}
              </T>
              {/* What a pull would bring and a push would send, as VS Code counts them beside the branch. */}
              {(repository.ahead > 0 || repository.behind > 0) && <T size={small} color={c.foreground}>{` ${repository.behind}↓ ${repository.ahead}↑`}</T>}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
