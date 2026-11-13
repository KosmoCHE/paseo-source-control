// The commit graph: one row per commit, its lanes drawn on the left.
//
// There is no SVG in a plugin, so a row's rail is built from plain views: a lane is a thin
// box, and a turn into or out of the dot is a box with two borders and one rounded corner.
// Rows are a fixed height, which is what lets the lanes of neighbouring rows meet.

import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Loading, copyText, useToast } from "@getpaseo/plugin/client/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pressable, View } from "react-native";
import type { ViewStyle } from "react-native";
import { showRpc, syncRpc } from "../shared/git";
import type { Commit, Ref, Scope } from "../shared/git";
import { showDiff } from "./diffTab";
import { key, useCommand } from "./git";
import { width } from "./lanes";
import type { Rail } from "./lanes";
import { FileRow, IconButton, Notice, T, Tint, useHost } from "./ui";

const LANE = 12; // between two lanes
const LINE = 2;
const TURN = 7; // a turn's corner radius
const MOST = 10; // lanes drawn before the rail is cut off: the subject needs room too
const laneX = (lane: number) => 11 + lane * LANE; // a lane's centre
const railWidth = (lanes: number[]) => laneX(Math.min(width(lanes), MOST) - 1) + 10;

/** A lane keeps one colour all the way down. */
function usePaint() {
  const { c } = useHost();
  const palette = [c.accent, c.statusWarning, c.statusSuccess, c.statusDanger, c.foregroundMuted];
  return (lane: number) => palette[lane % palette.length];
}

function Rails({ rail, height, kind }: { rail: Rail; height: number; kind: "commit" | "merge" | "head" }) {
  const { c } = useHost();
  const paint = usePaint();
  const mid = height / 2;
  const straight = (lane: number, top: number, bottom: number): ViewStyle => ({
    position: "absolute",
    left: laneX(lane) - LINE / 2,
    top,
    width: LINE,
    height: bottom - top,
    backgroundColor: paint(lane),
  });
  // From the dot sideways to a lane, then along it: upwards for a lane that ends here, downwards for one that starts.
  const turn = (lane: number, up: boolean): ViewStyle => {
    const right = lane > rail.col;
    const corner: ViewStyle = up
      ? { borderBottomWidth: LINE, ...(right ? { borderRightWidth: LINE, borderBottomRightRadius: TURN } : { borderLeftWidth: LINE, borderBottomLeftRadius: TURN }) }
      : { borderTopWidth: LINE, ...(right ? { borderRightWidth: LINE, borderTopRightRadius: TURN } : { borderLeftWidth: LINE, borderTopLeftRadius: TURN }) };
    return {
      position: "absolute",
      left: laneX(Math.min(lane, rail.col)) - LINE / 2,
      width: Math.abs(lane - rail.col) * LANE + LINE,
      top: up ? 0 : mid - LINE / 2,
      height: (up ? mid : height - mid) + LINE / 2,
      borderColor: paint(lane),
      ...corner,
    };
  };
  const ring = kind !== "commit"; // a merge is a ringed dot, the checked-out commit an empty ring
  const radius = ring ? 5.5 : 4;
  return (
    <View style={{ width: railWidth([rail.col, ...rail.through, ...rail.into, ...rail.out]), height, overflow: "hidden" }}>
      {rail.through.map((lane) => (
        <View key={"t" + lane} style={straight(lane, 0, height)} />
      ))}
      {rail.into.map((lane) => (
        <View key={"i" + lane} style={lane === rail.col ? straight(lane, 0, mid) : turn(lane, true)} />
      ))}
      {rail.out.map((lane) => (
        <View key={"o" + lane} style={lane === rail.col ? straight(lane, mid, height) : turn(lane, false)} />
      ))}
      <View
        style={{
          position: "absolute",
          left: laneX(rail.col) - radius,
          top: mid - radius,
          width: radius * 2,
          height: radius * 2,
          borderRadius: radius,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: ring ? c.surface0 : paint(rail.col),
          borderColor: paint(rail.col),
          borderWidth: ring ? LINE : 0,
        }}
      >
        {kind === "merge" && <View style={{ width: 3, height: 3, borderRadius: 1.5, backgroundColor: paint(rail.col) }} />}
      </View>
    </View>
  );
}

function Badges({ refs }: { refs: Ref[] }) {
  const { c, small } = useHost();
  const local = new Set(refs.filter((ref) => ref.kind !== "remote" && ref.kind !== "tag").map((ref) => ref.name));
  const icon = { head: "Target", branch: "GitBranch", remote: "Cloud", tag: "Tag" };
  return (
    <View style={{ flexDirection: "row", flexShrink: 0, maxWidth: "55%", gap: 4, marginLeft: 6, overflow: "hidden" }}>
      {refs.map((ref) => {
        const head = ref.kind === "head";
        const ink = head ? c.accentForeground : c.foreground;
        // A remote branch sitting on its local branch says nothing new by name: VS Code shows a bare cloud.
        const mirror = ref.kind === "remote" && local.has(ref.name.slice(ref.name.indexOf("/") + 1));
        return (
          <View
            key={ref.kind + ref.name}
            accessibilityLabel={`${ref.kind} ${ref.name}`}
            style={{ flexDirection: "row", alignItems: "center", gap: 3, height: small + 7, paddingHorizontal: 5, borderRadius: 9, backgroundColor: head ? c.accent : c.surface2 }}
          >
            <Icon name={icon[ref.kind]} size={small} color={ink} />
            {!mirror && (
              <T size={small} color={ink} lines={1} style={{ maxWidth: 110 }}>
                {ref.name}
              </T>
            )}
          </View>
        );
      })}
    </View>
  );
}

interface ItemProps {
  cwd: string;
  workspaceId: string;
  commit: Commit;
  rail: Rail;
  open: boolean;
  onToggle: () => void;
}

/** A commit's row, and under it the commit's details while it is open. */
export function CommitItem({ cwd, workspaceId, commit, rail, open, onToggle }: ItemProps) {
  const { c, row, small } = useHost();
  const head = commit.refs.some((ref) => ref.kind === "head");
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${commit.subject}, ${commit.author}`}
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        style={{ flexDirection: "row", alignItems: "center", height: row, paddingRight: 8 }}
      >
        {open && <Tint color={c.accent} opacity={0.14} />}
        <Rails rail={rail} height={row} kind={head ? "head" : commit.parents.length > 1 ? "merge" : "commit"} />
        <T lines={1} weight={head ? "600" : undefined} style={{ flexShrink: 1, minWidth: 0 }}>
          {commit.subject}
        </T>
        <T size={small} color={c.foregroundMuted} lines={1} style={{ flexShrink: 1000, minWidth: 0, marginLeft: 8 }}>
          {commit.author}
        </T>
        <View style={{ flex: 1 }} />
        {commit.refs.length > 0 && <Badges refs={commit.refs} />}
      </Pressable>
      {open && <Details cwd={cwd} workspaceId={workspaceId} commit={commit} rail={rail} />}
    </View>
  );
}

function Details({ cwd, workspaceId, commit, rail }: Pick<ItemProps, "cwd" | "workspaceId" | "commit" | "rail">) {
  const { c, small } = useHost();
  const paint = usePaint();
  const toast = useToast();
  const read = useRpc(showRpc);
  const detail = useQuery({ queryKey: key(cwd, "show", commit.hash), queryFn: () => read({ cwd, hash: commit.hash }), staleTime: Infinity });
  const copy = () =>
    copyText(commit.hash).then(
      () => toast.show("Commit hash copied", { variant: "success" }),
      (error: Error) => toast.error(error.message),
    );
  return (
    <View style={{ flexDirection: "row" }}>
      <Tint color={c.accent} opacity={0.06} />
      {/* The lanes that are alive under the row run on through the details, however tall they get. */}
      <View style={{ width: railWidth(rail.below), overflow: "hidden" }}>
        {rail.below.map((lane) => (
          <View key={lane} style={{ position: "absolute", left: laneX(lane) - LINE / 2, top: 0, bottom: 0, width: LINE, backgroundColor: paint(lane) }} />
        ))}
      </View>
      <View style={{ flex: 1, minWidth: 0, paddingVertical: 6, gap: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingRight: 8 }}>
          <T mono size={small} color={c.foregroundMuted}>
            {commit.hash.slice(0, 10)}
          </T>
          <IconButton name="Copy" label="Copy commit hash" onPress={copy} />
          <T size={small} color={c.foregroundMuted} lines={1} style={{ flex: 1, minWidth: 0, textAlign: "right" }}>
            {`${commit.author} · ${new Date(commit.time * 1000).toLocaleString()}`}
          </T>
        </View>
        {detail.error ? (
          <Notice failed>{detail.error.message}</Notice>
        ) : !detail.data ? (
          <Loading />
        ) : (
          <>
            <T size={small + 1} selectable style={{ paddingRight: 8 }}>
              {detail.data.message}
            </T>
            <View>
              {detail.data.files.map((file) => (
                <FileRow
                  key={file.path}
                  file={file}
                  onPress={() => showDiff({ workspaceId, cwd, source: { kind: "commit", hash: commit.hash }, file })}
                />
              ))}
            </View>
          </>
        )}
      </View>
    </View>
  );
}

/** The graph's title bar: which branches to show, and the remote. */
export function GraphHeader({ cwd, scope, onScope }: { cwd: string; scope: Scope; onScope: (scope: Scope) => void }) {
  const { c, row, small } = useHost();
  const toast = useToast();
  const queries = useQueryClient();
  const sync = useCommand(syncRpc, cwd);
  const run = (action: "fetch" | "pull" | "push", done: string) => sync.mutate({ action }, { onSuccess: () => toast.show(done, { variant: "success" }) });
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, height: row + 6, paddingHorizontal: 8, borderTopWidth: 1, borderColor: c.border }}>
      <T size={small} weight="600" color={c.foregroundMuted} style={{ flex: 1, textTransform: "uppercase" }}>
        Graph
      </T>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={scope === "all" ? "Showing all branches. Show the current branch only" : "Showing the current branch. Show all branches"}
        hitSlop={4}
        onPress={() => onScope(scope === "all" ? "current" : "all")}
        style={{ flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 4 }}
      >
        <Icon name="GitBranch" size={small + 2} color={c.foregroundMuted} />
        <T size={small} color={c.foregroundMuted}>
          {scope === "all" ? "All" : "Auto"}
        </T>
      </Pressable>
      <IconButton name="CloudDownload" label="Fetch" disabled={sync.isPending} onPress={() => run("fetch", "Fetched")} />
      <IconButton name="ArrowDownToLine" label="Pull" disabled={sync.isPending} onPress={() => run("pull", "Pulled")} />
      <IconButton name="ArrowUpFromLine" label="Push" disabled={sync.isPending} onPress={() => run("push", "Pushed")} />
      <IconButton name="RefreshCw" label="Refresh" onPress={() => void queries.invalidateQueries({ queryKey: key(cwd) })} />
    </View>
  );
}
