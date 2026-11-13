// Runs git for the panel. Every handler takes the repository's directory and shells out.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type {
  Commit,
  FileChange,
  Ref,
  commitRpc,
  diffRpc,
  discardRpc,
  logRpc,
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
}

export async function git(cwd: string, args: string[], { accept = [], timeout }: Options = {}): Promise<string> {
  try {
    const { stdout } = await run("git", args, { cwd, env: ENV, timeout, maxBuffer: 256 * 1024 * 1024 });
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
      status.conflicts.push({ path: parts.slice(10).join(" "), status: "U" });
    } else if (parts[0] === "?") {
      status.changes.push({ path: entry.slice(2), status: "?" });
    }
  }
  return status;
}

export async function status({ cwd }: RpcInput<typeof statusRpc>): Promise<RpcOutput<typeof statusRpc>> {
  const [porcelain, refs] = await Promise.all([
    git(cwd, ["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"]),
    git(cwd, ["for-each-ref", "--format=%(objectname) %(refname)"]),
  ]);
  return { ...parseStatus(porcelain), refs: createHash("sha1").update(refs).digest("hex") };
}

export async function stage({ cwd, files }: RpcInput<typeof stageRpc>) {
  await git(cwd, ["add", "--all", "--", ...pathsOf(files)]);
  return {};
}

export async function unstage({ cwd, files }: RpcInput<typeof unstageRpc>) {
  const born = await git(cwd, ["rev-parse", "--verify", "--quiet", "HEAD"], { accept: [1] });
  // Before the first commit there is no HEAD to restore the index from.
  await git(cwd, [...(born ? ["restore", "--staged"] : ["rm", "--cached", "--quiet"]), "--", ...pathsOf(files)]);
  return {};
}

export async function discard({ cwd, files }: RpcInput<typeof discardRpc>) {
  const untracked = files.filter((file) => file.status === "?");
  const tracked = files.filter((file) => file.status !== "?");
  if (tracked.length) await git(cwd, ["restore", "--worktree", "--", ...pathsOf(tracked)]);
  if (untracked.length) await git(cwd, ["clean", "--force", "--quiet", "--", ...pathsOf(untracked)]);
  return {};
}

export async function commit({ cwd, message, amend }: RpcInput<typeof commitRpc>) {
  await git(cwd, ["commit", ...(amend ? ["--amend"] : []), ...(message.trim() ? ["--message", message] : ["--no-edit"])]);
  return {};
}

export async function sync({ cwd, action }: RpcInput<typeof syncRpc>) {
  await git(cwd, [action], { timeout: 120_000 });
  return {};
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

export async function log({ cwd, scope, limit }: RpcInput<typeof logRpc>): Promise<RpcOutput<typeof logRpc>> {
  const tips =
    scope === "all"
      ? ["--branches", "--remotes", "--tags"]
      : // The checked-out branch's upstream; --ignore-missing covers one that was deleted.
        (await git(cwd, ["for-each-ref", "--format=%(if)%(HEAD)%(then)%(upstream)%(end)", "refs/heads"])).split("\n").filter(Boolean);
  const out = await git(cwd, [
    "log",
    "--date-order",
    "--decorate=full",
    "--format=" + FORMAT,
    "--max-count=" + (limit + 1), // one more tells whether there is more
    "--ignore-missing",
    "HEAD",
    ...tips,
    "--",
  ]);
  const commits = parseLog(out);
  return { commits: commits.slice(0, limit), more: commits.length > limit };
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
  const [message, files] = await Promise.all([
    git(cwd, ["show", "--no-patch", "--format=%B", hash]),
    git(cwd, ["show", ...AS_PATCH, "--name-status", "-z", hash]),
  ]);
  return { message: message.trim(), files: parseNameStatus(files) };
}

export async function diff({ cwd, source, file }: RpcInput<typeof diffRpc>): Promise<RpcOutput<typeof diffRpc>> {
  const paths = pathsOf([file]);
  if (source.kind === "commit") return { diff: await git(cwd, ["show", ...AS_PATCH, source.hash, "--", ...paths]) };
  if (source.kind === "staged") return { diff: await git(cwd, ["diff", "--cached", "--find-renames", "--", ...paths]) };
  // An untracked file has nothing to compare with, so it is compared with nothing.
  if (file.status === "?") return { diff: await git(cwd, ["diff", "--no-index", "--", "/dev/null", file.path], { accept: [1] }) };
  return { diff: await git(cwd, ["diff", "--", ...paths]) };
}
