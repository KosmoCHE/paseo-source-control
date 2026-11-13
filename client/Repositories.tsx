// The workspace's repositories. One is selected, and the rest of the panel shows that one.

import { Icon } from "@getpaseo/plugin/client/ui";
import { Pressable, View } from "react-native";
import type { Repository } from "../shared/git";
import { useStatus } from "./git";
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
            <Icon name="FolderGit2" size={small + 3} color={c.foregroundMuted} />
            <T lines={1} weight={chosen ? "600" : undefined} style={{ flex: 1, minWidth: 0 }}>
              {repository.name}
            </T>
            {chosen ? <LiveBranch repository={repository} /> : <Branch name={repository.branch ?? "detached"} />}
          </Pressable>
        );
      })}
    </View>
  );
}

function Branch({ name, ahead = 0, behind = 0 }: { name: string; ahead?: number; behind?: number }) {
  const { c, small } = useHost();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 3, flexShrink: 0, maxWidth: "50%" }}>
      <Icon name="GitBranch" size={small + 1} color={c.foregroundMuted} />
      <T size={small} color={c.foregroundMuted} lines={1} style={{ flexShrink: 1, minWidth: 0 }}>
        {name + (ahead || behind ? `  ↑${ahead} ↓${behind}` : "")}
      </T>
    </View>
  );
}

/** The selected repository is being read anyway: its branch as it is now, and how far it is from its upstream. */
function LiveBranch({ repository }: { repository: Repository }) {
  const { data } = useStatus(repository.root);
  if (!data) return <Branch name={repository.branch ?? "detached"} />;
  return <Branch name={data.branch ?? `${data.head?.slice(0, 7)}`} ahead={data.ahead} behind={data.behind} />;
}
