// Runs git for the panel. Every handler takes the repository's directory and shells out.
//
// `chunks` is adapted from splitInChunks in VS Code 1.142.0's extensions/git/src/util.ts, and `baseOf` and `createdFrom`
// from getBranchBase and getBranchBaseFromReflog in its extensions/git/src/repository.ts.
// Copyright (c) Microsoft Corporation. Licensed under the MIT License: https://github.com/microsoft/vscode/blob/1.142.0/LICENSE.txt

import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { appendFile, readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import { REF_SEARCH_LIMIT, scopeSchema } from "../shared/git.ts";
import type {
  Commit,
  FileChange,
  Ref,
  commitRpc,
  compareRpc,
  discardRpc,
  ignoreRpc,
  logRpc,
  markersRpc,
  refsRpc,
  remotesRpc,
  removeRpc,
  showRpc,
  stageRpc,
  statusRpc,
  syncRpc,
  unstageRpc,
} from "../shared/git";

const run = promisify(execFile);

const ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0", // there is no terminal to answer a credential prompt
  GIT_OPTIONAL_LOCKS: "0", // polling must not take the index lock from an agent's own git
};

interface Options {
  /** Exit codes that are answers, not failures. */
  accept?: number[];
  timeout?: number;
  env?: Record<string, string>;
}

export async function git(cwd: string, args: string[], { accept = [], timeout, env }: Options = {}): Promise<string> {
  try {
    const { stdout } = await run("git", args, { cwd, env: { ...ENV, ...env }, timeout, maxBuffer: 256 * 1024 * 1024 });
    return stdout;
  } catch (error) {
    const failure = error as { code?: unknown; stdout?: string; stderr?: string; message: string };
    // An accepted code can still be a failure: `diff --no-index` exits 1 for a difference and for a missing file alike.
    const answered = typeof failure.code === "number" && accept.includes(failure.code) && (failure.stdout || !failure.stderr);
    if (answered) return failure.stdout ?? "";
    // git's own words are the useful part, and `git commit` says them on stdout; the command line stays in the cause.
    throw new Error(failure.stderr?.trim() || failure.stdout?.trim() || failure.message, { cause: error });
  }
}

/** A rename is two paths to git. */
const pathsOf = (files: FileChange[]) => files.flatMap((file) => (file.from ? [file.from, file.path] : [file.path]));

const MAX_CLI_LENGTH = 30_000; // VS Code's: past some length a command line is cut short (microsoft/vscode#65693)

/** Splits paths into parts that each keep a command line under that length, as VS Code's splitInChunks does. */
function* chunks(paths: string[]) {
  let chunk: string[] = [];
  let length = 0;
  for (const path of paths) {
    if (chunk.length && length + path.length > MAX_CLI_LENGTH) {
      yield chunk;
      [chunk, length] = [[], 0];
    }
    chunk.push(path);
    length += path.length;
  }
  if (chunk.length) yield chunk;
}

/** Runs `git <args> -- <paths>`, a part of the paths at a time. */
async function onPaths(cwd: string, args: string[], paths: string[]) {
  for (const chunk of chunks(paths)) await git(cwd, [...args, "--", ...chunk]);
}

// --- working tree ---------------------------------------------------------------

/** Reads `git status --porcelain=v2 --branch -z`. */
export function parseStatus(out: string) {
  const status = {
    branch: null as string | null,
    head: null as string | null,
    upstream: null as string | null,
    ahead: 0,
    behind: 0,
    conflicts: [] as FileChange[],
    staged: [] as FileChange[],
    changes: [] as FileChange[],
  };
  const entries = out.split("\0");
  for (let n = 0; n < entries.length; n++) {
    const entry = entries[n];
    const parts = entry.split(" ");
    if (parts[0] === "#") {
      const value = parts.slice(2).join(" ");
      if (parts[1] === "branch.oid") status.head = value === "(initial)" ? null : value;
      else if (parts[1] === "branch.head") status.branch = value === "(detached)" ? null : value;
      else if (parts[1] === "branch.upstream") status.upstream = value;
      else if (parts[1] === "branch.ab") {
        status.ahead = Number(parts[2]);
        status.behind = -Number(parts[3]);
      }
    } else if (parts[0] === "1" || parts[0] === "2") {
      // "<type> <XY> … <path>": X is the index against HEAD, Y the working tree against the index.
      const renamed = parts[0] === "2";
      const [index, tree] = parts[1];
      const path = parts.slice(renamed ? 9 : 8).join(" ");
      const from = renamed ? entries[++n] : undefined;
      const moved = (letter: string) => letter === "R" || letter === "C";
      if (index !== ".") status.staged.push({ path, status: index, ...(moved(index) && { from }) });
      if (tree !== ".") status.changes.push({ path, status: tree, ...(moved(tree) && { from }) });
    } else if (parts[0] === "u") {
      status.conflicts.push({ path: parts.slice(10).join(" "), status: "U", conflict: parts[1] as FileChange["conflict"] });
    } else if (parts[0] === "?") {
      status.changes.push({ path: entry.slice(2), status: "?" });
    }
  }
  return status;
}

const STATUS_LIMIT = 10_000; // VS Code's git.statusLimit

/**
 * Reads `git status --porcelain=v2 --branch -z` as it comes, and stops git, as VS Code does, once more than STATUS_LIMIT
 * files are listed: a folder of untracked files can hold hundreds of thousands, and listing them all chokes the panel.
 * What is returned ends with the last file within the limit; `cut` tells whether files were left out.
 */
export function porcelain(cwd: string, untracked: "all" | "normal"): Promise<{ out: string; cut: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["status", "--porcelain=v2", "--branch", "-z", `--untracked-files=${untracked}`], { cwd, env: ENV });
    let out = "";
    let read = 0; // how much of `out` has been gone through
    let kept = 0; // where the last file within the limit ends
    let files = 0;
    let renamed = false; // the next field is the old path of a rename, which ends its entry
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    child.stdout.on("data", (chunk: string) => {
      out += chunk;
      for (let end = out.indexOf("\0", read); end !== -1; end = out.indexOf("\0", read)) {
        const kind = out.slice(read, read + 2);
        read = end + 1;
        if (renamed) renamed = false;
        else if (kind[0] === "#") continue; // a line about the branch
        else if (kind === "2 ") {
          renamed = true;
          continue;
        }
        if (++files <= STATUS_LIMIT) kept = read;
        else {
          child.stdout.removeAllListeners("data");
          child.kill();
          resolve({ out: out.slice(0, kept), cut: true });
          return;
        }
      }
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (files > STATUS_LIMIT) return; // stopped on purpose
      if (code === 0) resolve({ out, cut: false });
      else reject(new Error(stderr.trim() || `git status exited with code ${code}`));
    });
  });
}

const HUGE = ["node_modules"]; // VS Code's Repository.KnownHugeFolderNames

/** What VS Code offers to ignore when a repository has too many changes: the folders of HUGE at its root that git does not ignore. */
async function hugeFolders(cwd: string) {
  const there = HUGE.filter((name) => existsSync(join(cwd, name)));
  if (!there.length) return [];
  const ignored = (await git(cwd, ["check-ignore", "--", ...there], { accept: [1] })).split("\n");
  return there.filter((name) => !ignored.includes(name));
}

export async function status({ cwd }: RpcInput<typeof statusRpc>): Promise<RpcOutput<typeof statusRpc>> {
  const [{ out, cut }, all, state] = await Promise.all([porcelain(cwd, "all"), git(cwd, ["for-each-ref", "--format=%(objectname) %(refname)"]), underWay(cwd)]);
  const now = parseStatus(out);
  const refs = createHash("sha1").update(all).digest("hex");
  // A branch without a commit yet has no reflog to read.
  const base = now.branch && now.head ? await knownBase(cwd, now.branch, refs) : null;
  return { ...now, ...state, base: base === now.upstream ? null : base, refs, cutAt: cut ? STATUS_LIMIT : null, hugeFolders: cut ? await hugeFolders(cwd) : [] };
}

const gitDirs = new Map<string, string>(); // by repository: where git keeps its files, apart from the working tree in a worktree

async function gitDir(cwd: string) {
  let dir = gitDirs.get(cwd);
  if (dir === undefined) gitDirs.set(cwd, (dir = (await git(cwd, ["rev-parse", "--absolute-git-dir"])).trim()));
  return dir;
}

/** VS Code's test for a rebase under way: one of git's rebase folders, and the commit being applied. */
const rebasing = (dir: string) => (existsSync(join(dir, "rebase-apply")) || existsSync(join(dir, "rebase-merge"))) && existsSync(join(dir, "REBASE_HEAD"));

const uncommented = (text: string) => text.replace(/^\s*#.*$\n?/gm, "").trim(); // VS Code's stripCommitMessageComments

/** A merge or rebase under way, and the message VS Code puts in the commit box for it, as VS Code reads them. */
async function underWay(cwd: string) {
  const dir = await gitDir(cwd);
  const file = async (name: string) => (existsSync(join(dir, name)) ? readFile(join(dir, name), "utf8") : "");
  const rebase = rebasing(dir);
  const rebaseMessage = rebase ? (await git(cwd, ["show", "--no-patch", "--format=%B", (await file("REBASE_HEAD")).trim()])).trimEnd() : null;
  const template = uncommented(await file("MERGE_MSG")) || uncommented(await file("SQUASH_MSG")) || (await commitTemplate(cwd));
  return { operation: rebase ? ("rebase" as const) : existsSync(join(dir, "MERGE_HEAD")) ? ("merge" as const) : null, rebaseMessage, template };
}

/** git's commit.template, found as git finds it: "~" is the home folder, and a relative path is from the repository's root. */
async function commitTemplate(cwd: string) {
  const set = (await git(cwd, ["config", "--get", "commit.template"], { accept: [1] })).trim();
  if (!set) return "";
  const path = set.replace(/^~([^/]*)\//, (_, user: string) => `${user ? join(homedir(), "..", user) : homedir()}/`);
  const file = isAbsolute(path) ? path : join(cwd, path);
  // As in VS Code, a template that is not there is none.
  return existsSync(file) ? uncommented(await readFile(file, "utf8")) : "";
}

/** Adds paths to the repository's .gitignore, a line each, as VS Code's Add to .gitignore writes them. */
export async function ignore({ cwd, paths }: RpcInput<typeof ignoreRpc>) {
  const file = join(cwd, ".gitignore");
  const before = existsSync(file) ? await readFile(file, "utf8") : "";
  const lines = paths.map((path) => path.replace(/\\|\[/g, (match) => (match === "\\" ? "/" : `\\${match}`)));
  await appendFile(file, (before === "" || before.endsWith("\n") ? "" : "\n") + lines.join("\n") + "\n");
  return {};
}

// --- the branch a branch was made from ------------------------------------------

const CREATED = "branch: Created from ";
const REMOTES = "refs/remotes/";

/**
 * The branch on a remote that `branch` was made from, found as VS Code finds it: the `vscode-merge-base` VS Code
 * keeps in the branch's config, else what the reflog says the branch was created from, else the default branch of
 * the default remote. VS Code writes what it finds back to the config; this reads only.
 */
export async function baseOf(cwd: string, branch: string): Promise<string | null> {
  const kept = (await git(cwd, ["config", "--get", `branch.${branch}.vscode-merge-base`], { accept: [1] })).trim();
  const fromConfig = kept && (await onRemote(cwd, kept, false));
  if (fromConfig) return fromConfig;
  const created = await createdFrom(cwd, branch);
  const fromReflog = created && (await onRemote(cwd, created, true));
  if (fromReflog) return fromReflog;
  const remotes = (await git(cwd, ["remote"])).split("\n").filter(Boolean);
  const remote = remotes.includes("origin") ? "origin" : remotes[0];
  if (!remote) return null;
  const head = (await git(cwd, ["symbolic-ref", "--quiet", "--short", `${REMOTES}${remote}/HEAD`], { accept: [1] })).trim();
  return head ? onRemote(cwd, head, false) : null;
}

/** What the reflog says `branch` was created from, read as VS Code reads it: nothing unless it says so exactly once. */
async function createdFrom(cwd: string, branch: string): Promise<string | null> {
  const reflog = async (ref: string) => (await git(cwd, ["reflog", "show", "--format=%gs", ref, "--"])).split("\n");
  const created = (await reflog(`refs/heads/${branch}`)).filter((entry) => entry.startsWith(CREATED));
  if (created.length !== 1) return null;
  const from = created[0].slice(CREATED.length);
  if (from !== "HEAD") return from;
  // Made from HEAD: the branch HEAD left the first time it moved to this one, as "checkout: moving from <it> to <branch>".
  const moves = (await reflog("HEAD")).filter((entry) => entry.startsWith("checkout: moving from ") && entry.endsWith(` to ${branch}`));
  return moves.length ? moves[moves.length - 1].split(" ")[3] : null;
}

/**
 * The branch on a remote that `name` stands for, such as origin/main: the name itself when it is one, or with
 * `follow` the upstream of the local branch it names. As in VS Code, a local branch of that name comes first.
 */
async function onRemote(cwd: string, name: string, follow: boolean): Promise<string | null> {
  const out = await git(cwd, ["for-each-ref", "--format=%(refname)%00%(upstream)", `refs/heads/${name}`, `${REMOTES}${name}`]);
  const refs = new Map(out.split("\n").map((line) => line.split("\0") as [string, string]));
  const upstream = refs.get(`refs/heads/${name}`);
  if (upstream !== undefined) return follow && upstream.startsWith(REMOTES) ? upstream.slice(REMOTES.length) : null;
  return refs.has(`${REMOTES}${name}`) ? name : null;
}

const bases = new Map<string, { branch: string; refs: string; base: string | null }>(); // by repository: the last base found

/** The base, looked for again only when the branch changes or a ref moves: the status is read every few seconds. */
async function knownBase(cwd: string, branch: string, refs: string) {
  const known = bases.get(cwd);
  if (known?.branch === branch && known.refs === refs) return known.base;
  const base = await baseOf(cwd, branch);
  bases.set(cwd, { branch, refs, base });
  return base;
}

export async function stage({ cwd, files }: RpcInput<typeof stageRpc>) {
  await onPaths(cwd, ["add", "--all"], pathsOf(files));
  return {};
}

export async function unstage({ cwd, files }: RpcInput<typeof unstageRpc>) {
  const born = await git(cwd, ["rev-parse", "--verify", "--quiet", "HEAD"], { accept: [1] });
  // Before the first commit there is no HEAD to restore the index from.
  await onPaths(cwd, born ? ["restore", "--staged"] : ["rm", "--cached", "--quiet"], pathsOf(files));
  return {};
}

export async function discard({ cwd, files, trash }: RpcInput<typeof discardRpc>): Promise<RpcOutput<typeof discardRpc>> {
  const untracked = pathsOf(files.filter((file) => file.status === "?"));
  const tracked = files.filter((file) => file.status !== "?");
  if (tracked.length) await onPaths(cwd, ["restore", "--worktree"], pathsOf(tracked));
  if (!untracked.length) return { trashFailed: false };
  if (!trash) {
    await onPaths(cwd, ["clean", "--force", "--quiet"], untracked);
    return { trashFailed: false };
  }
  try {
    await toTrash(cwd, untracked);
  } catch (error) {
    // As in VS Code, the panel then asks whether to delete them for good.
    console.warn(`Could not move to the Trash in ${cwd}: ${(error as Error).message}`);
    return { trashFailed: true };
  }
  return { trashFailed: false };
}

/** Moves files to the Trash with the `trash` command macOS has had since 15. No other system is known to have one. */
async function toTrash(cwd: string, paths: string[]) {
  if (process.platform !== "darwin") throw new Error(`No Trash is known on ${process.platform}`);
  for (const chunk of chunks(paths)) await run("/usr/bin/trash", chunk, { cwd });
}

export async function remove({ cwd, files }: RpcInput<typeof removeRpc>) {
  await onPaths(cwd, ["rm", "--quiet"], pathsOf(files));
  return {};
}

const MARKER = /^<{7}\s|^={7}$|^>{7}\s/m; // VS Code's test for a conflict left in a file

export async function markers({ cwd, paths }: RpcInput<typeof markersRpc>): Promise<RpcOutput<typeof markersRpc>> {
  const marked = await Promise.all(paths.map(async (path) => MARKER.test(await readFile(join(cwd, path), "utf8"))));
  return { paths: paths.filter((_, n) => marked[n]) };
}

export async function commit({ cwd, message, amend, all }: RpcInput<typeof commitRpc>) {
  if (all) await git(cwd, ["add", "--all"]);
  if (rebasing(await gitDir(cwd))) {
    // As VS Code continues a rebase: with the commit's own message, no editor asked for.
    await git(cwd, ["rebase", "--continue"], { env: { GIT_EDITOR: "true" } });
    return {};
  }
  try {
    // As VS Code commits: with the author git is told, never one it guesses from the machine.
    await git(cwd, ["-c", "user.useConfigOnly=true", "commit", ...(amend ? ["--amend"] : []), ...(message.trim() ? ["--message", message] : ["--no-edit"])]);
  } catch (error) {
    if (/no (name|email) was given and auto-detection is disabled/.test((error as Error).message))
      throw new Error('Make sure you configure your "user.name" and "user.email" in git.', { cause: error });
    throw error;
  }
  return {};
}

const REMOTE = { timeout: 120_000 }; // a remote that does not answer is given up on

export async function sync({ cwd, action, remote }: RpcInput<typeof syncRpc>) {
  if (action === "sync") await syncChanges(cwd);
  else if (action === "publish") await git(cwd, ["push", "--set-upstream", remote!, (await git(cwd, ["symbolic-ref", "--short", "HEAD"])).trim()], REMOTE);
  else await git(cwd, [action], REMOTE);
  return {};
}

/**
 * VS Code's Sync Changes: pull the upstream's branch from its remote, tags too, then push to it if the branch had commits
 * the upstream lacked.
 */
async function syncChanges(cwd: string) {
  const branch = (await git(cwd, ["symbolic-ref", "--short", "HEAD"])).trim();
  const [remote, ref] = (await git(cwd, ["for-each-ref", "--format=%(upstream:remotename)%00%(upstream:remoteref)", `refs/heads/${branch}`])).trim().split("\0");
  if (!remote || !ref) throw new Error(`The branch "${branch}" has no upstream to sync with.`);
  const upstream = ref.replace(/^refs\/heads\//, "");
  const ahead = Number((await git(cwd, ["rev-list", "--count", "@{upstream}..HEAD"])).trim());
  await git(cwd, ["pull", "--tags", remote, upstream], REMOTE);
  if (ahead > 0) await git(cwd, ["push", remote, `${branch}:${upstream}`], REMOTE);
}

export async function remotes({ cwd }: RpcInput<typeof remotesRpc>): Promise<RpcOutput<typeof remotesRpc>> {
  return { remotes: (await git(cwd, ["remote"])).split("\n").filter(Boolean) };
}

// --- history --------------------------------------------------------------------

const FIELD = "\x1f";
const RECORD = "\x1e";
const FORMAT = ["%H", "%P", "%an", "%at", "%D", "%s"].join("%x1f") + "%x1e";

/** Reads `%D` as printed under `--decorate=full`. */
function parseRefs(decoration: string): Ref[] {
  const refs: Ref[] = [];
  for (const entry of decoration.split(", ")) {
    const name = entry.replace(/^HEAD -> /, "");
    if (name === "HEAD") refs.push({ kind: "head", name });
    else if (name.startsWith("refs/heads/")) refs.push({ kind: entry === name ? "branch" : "head", name: name.slice(11) });
    else if (name.startsWith("refs/remotes/") && !name.endsWith("/HEAD")) refs.push({ kind: "remote", name: name.slice(13) });
    else if (name.startsWith("tag: refs/tags/")) refs.push({ kind: "tag", name: name.slice(15) });
  }
  return refs;
}

/** Reads `git log --format=FORMAT --decorate=full`. */
export function parseLog(out: string): Commit[] {
  return out
    .split(RECORD)
    .map((record) => record.replace(/^\n/, ""))
    .filter(Boolean)
    .map((record) => {
      const [hash, parents, author, time, refs, subject] = record.split(FIELD);
      return { hash, parents: parents ? parents.split(" ") : [], author, time: Number(time), subject, refs: parseRefs(refs) };
    });
}

const REF_NAMESPACES = ["refs/heads", "refs/remotes", "refs/tags"];
const remoteHead = (id: string) => id.startsWith(REMOTES) && id.endsWith("/HEAD");

/** VS Code's HistoryItemRefPicker searches the display name, without the namespace. Filter before limiting the Git output. */
export async function refs({ cwd, query }: RpcInput<typeof refsRpc>): Promise<RpcOutput<typeof refsRpc>> {
  // These glob characters (and NUL) cannot occur in any Git ref name.
  if (/[\0*?\[\\]/.test(query)) return { refs: [], more: false };
  // Match names without ASCII case distinctions while keeping Git's namespaces case-sensitive.
  const text = query.replace(/[a-z]/gi, (c) => `[${c.toLowerCase()}${c.toUpperCase()}]`);
  const patterns = REF_NAMESPACES.flatMap((ns) => text ? [`${ns}/**/*${text}*`, `${ns}/**/*${text}*/**`] : [ns]);
  const out = await git(cwd, ["for-each-ref", "--format=%(refname)", `--count=${REF_SEARCH_LIMIT + 1}`, "--", ...patterns]);
  const found = out.split("\n").filter(Boolean);
  // Hide remote HEAD aliases even on Git before 2.42 (no --exclude). `more` means the raw search was truncated.
  return { refs: found.filter((id) => !remoteHead(id)).slice(0, REF_SEARCH_LIMIT), more: found.length > REF_SEARCH_LIMIT };
}

/** Resolve exact IDs to revisions, as in VS Code's _resolveHistoryItemFilter. A deleted foo must never enumerate foo/* instead. */
async function refTips(cwd: string, ids: string[]) {
  const tips = new Map<string, { oid: string; upstream: string }>();
  for (const part of chunks(ids.filter((id) => !remoteHead(id)))) {
    // A literal for-each-ref pattern matches a whole subtree. Escaping its final character forces an anchored glob instead.
    const exact = part.map((id) => id.replace(/.$/su, "\\$&"));
    const out = await git(cwd, ["for-each-ref", "--format=%(refname)%00%(objectname)%00%(upstream)", `--count=${part.length}`, "--", ...exact]);
    for (const line of out.split("\n").filter(Boolean)) {
      const [id, oid, upstream] = line.split("\0");
      tips.set(id, { oid, upstream });
    }
  }
  return tips;
}

export async function log({ cwd, scope, limit }: RpcInput<typeof logRpc>): Promise<RpcOutput<typeof logRpc>> {
  scopeSchema.parse(scope);
  const head = (await git(cwd, ["symbolic-ref", "--quiet", "HEAD"], { accept: [1] })).split("\n")[0]; // empty when detached
  const selected = Array.isArray(scope) ? [...new Set(scope)] : [];
  const tips = await refTips(cwd, [...new Set([...selected, ...(head ? [head] : [])])]);
  if (Array.isArray(scope)) {
    scope = selected.filter((id) => tips.has(id));
    if (!scope.length) scope = "current";
  }
  const current = tips.get(head);
  const upstream = current?.upstream ?? "";
  // Never seed a manual selection with HEAD. Pass the resolved object IDs, not revision expressions or ambiguous short names.
  let revisions: string[];
  if (Array.isArray(scope)) revisions = scope.map((id) => tips.get(id)!.oid);
  else if (scope === "all") revisions = ["--ignore-missing", "HEAD", "--branches", "--remotes", "--tags"];
  else {
    const base = current && await baseOf(cwd, head.slice("refs/heads/".length));
    revisions = ["--ignore-missing", "HEAD", upstream, base ? REMOTES + base : ""].filter(Boolean);
  }

  // scmHistoryViewPane gates each pending row on its own ref ID, not on another ref reaching the same commit.
  const incoming = !Array.isArray(scope) || scope.includes(upstream);
  const outgoing = !Array.isArray(scope) || scope.includes(head);
  const [out, sync] = await Promise.all([
    git(cwd, ["log", "--date-order", "--decorate=full", "--format=" + FORMAT, "--max-count=" + (limit + 1), ...revisions, "--"]),
    incoming || outgoing ? syncOf(cwd, upstream) : null,
  ]);
  if (sync && !incoming) sync.showIncoming = false;
  if (sync && !outgoing) sync.showOutgoing = false;
  const commits = parseLog(out);
  return { scope, commits: commits.slice(0, limit), more: commits.length > limit, sync };
}

/** Where HEAD and `upstream` stand, for VS Code's Incoming and Outgoing Changes: null when they are one commit, or have none in common. */
async function syncOf(cwd: string, upstream: string): Promise<RpcOutput<typeof logRpc>["sync"]> {
  if (!upstream) return null;
  // An upstream that was deleted, or HEAD before the first commit, verifies to nothing.
  const verify = async (ref: string) => (await git(cwd, ["rev-parse", "--verify", "--quiet", ref + "^{commit}"], { accept: [1] })).trim();
  const [head, tip] = await Promise.all([verify("HEAD"), verify(upstream)]);
  if (!head || !tip || head === tip) return null;
  const base = (await git(cwd, ["merge-base", head, tip], { accept: [1] })).trim();
  return base ? { head, upstream: tip, base } : null;
}

/** Reads `--name-status -z`: status, path, and for a rename the old path before the new one. */
export function parseNameStatus(out: string): FileChange[] {
  const fields = out.split("\0");
  const files: FileChange[] = [];
  for (let n = 0; n + 1 < fields.length; ) {
    const status = fields[n++][0];
    if (status === "R" || status === "C") {
      const from = fields[n++];
      files.push({ path: fields[n++], from, status });
    } else files.push({ path: fields[n++], status });
  }
  return files;
}

// A merge is shown against its first parent: what it brought into the branch.
const AS_PATCH = ["--diff-merges=first-parent", "--format=", "--find-renames"];

export async function show({ cwd, hash }: RpcInput<typeof showRpc>): Promise<RpcOutput<typeof showRpc>> {
  const [message, files, stats] = await Promise.all([
    git(cwd, ["show", "--no-patch", "--format=%B", hash]),
    git(cwd, ["show", ...AS_PATCH, "--name-status", "-z", hash]),
    git(cwd, ["show", ...AS_PATCH, "--shortstat", hash]),
  ]);
  return { message: message.trim(), files: parseNameStatus(files), stats: parseShortStat(stats) };
}

/** Reads `--shortstat`, " 3 files changed, 7 insertions(+), 1 deletion(-)", which leaves out a count of nothing. */
export function parseShortStat(out: string) {
  const count = (pattern: RegExp) => Number(pattern.exec(out)?.[1] ?? 0);
  return { files: count(/(\d+) files? changed/), insertions: count(/(\d+) insertions?\(\+\)/), deletions: count(/(\d+) deletions?\(-\)/) };
}

export async function compare({ cwd, from, to }: RpcInput<typeof compareRpc>): Promise<RpcOutput<typeof compareRpc>> {
  return { files: parseNameStatus(await git(cwd, ["diff", "--name-status", "-z", "--find-renames", from, to])) };
}
