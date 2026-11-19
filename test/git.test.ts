// Runs the daemon half against throwaway repositories.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { logRpc, MAX_REF_QUERY_LENGTH, MAX_SELECTED_REFS, REF_SEARCH_LIMIT, refsRpc } from "../shared/git.ts";

// The module reads the environment once: keep the user's git config, hooks and signing out of it.
Object.assign(process.env, {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Ada",
  GIT_AUTHOR_EMAIL: "ada@example.com",
  GIT_COMMITTER_NAME: "Ada",
  GIT_COMMITTER_EMAIL: "ada@example.com",
});
const { baseOf, commit, compare, discard, ignore, log, markers, refs, remotes, remove, show, stage, status, sync, unstage } = await import("../server/git.ts");
const { diff } = await import("../server/diff.ts");

/** The line ranges of a diff's changes, before and after. */
const ranges = (result: Awaited<ReturnType<typeof diff>>) => (result.kind === "diff" ? result.changes.map((change) => [change.original, change.modified]) : result.kind);

function repository(t: TestContext) {
  const scratch = join(import.meta.dirname, "../tmp");
  mkdirSync(scratch, { recursive: true });
  const cwd = mkdtempSync(join(scratch, "source-control-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  const write = (path: string, text: string) => writeFileSync(join(cwd, path), text);
  git("init", "--quiet", "--initial-branch=main");
  return { cwd, git, write };
}

test("the first commit: untracked, staged, unstaged again, committed", async (t) => {
  const { cwd, write } = repository(t);
  write("read me.txt", "hello\n");

  let now = await status({ cwd });
  assert.equal(now.branch, "main");
  assert.equal(now.head, null);
  assert.deepEqual(now.changes, [{ path: "read me.txt", status: "?" }]);
  // As VS Code opens it: the file itself, there being nothing to compare it with.
  assert.deepEqual(await diff({ cwd, source: { kind: "changes" }, file: now.changes[0] }), { kind: "file", lines: ["hello", ""] });

  await stage({ cwd, files: now.changes });
  now = await status({ cwd });
  assert.deepEqual(now.staged, [{ path: "read me.txt", status: "A" }]);
  assert.deepEqual(now.changes, []);

  await unstage({ cwd, files: now.staged });
  now = await status({ cwd });
  assert.deepEqual(now.staged, []);
  assert.deepEqual(now.changes, [{ path: "read me.txt", status: "?" }]);

  await stage({ cwd, files: now.changes });
  await commit({ cwd, message: "first", amend: false, all: false });
  now = await status({ cwd });
  assert.match(now.head!, /^[0-9a-f]{40}$/);
  assert.deepEqual([now.staged, now.changes, now.conflicts], [[], [], []]);
});

test("edits, renames and discards", async (t) => {
  const { cwd, git, write } = repository(t);
  write("a.txt", "one\n");
  write("b.txt", "two\n");
  git("add", ".");
  git("commit", "--quiet", "--message=first");

  write("a.txt", "one\nmore\n");
  git("mv", "b.txt", "c.txt");
  write("new.txt", "new\n");
  let now = await status({ cwd });
  assert.deepEqual(now.staged, [{ path: "c.txt", status: "R", from: "b.txt" }]);
  assert.deepEqual(now.changes, [
    { path: "a.txt", status: "M" },
    { path: "new.txt", status: "?" },
  ]);
  assert.deepEqual(ranges(await diff({ cwd, source: { kind: "changes" }, file: now.changes[0] })), [[[2, 2], [2, 3]]]);
  // A rename compares the old path with the new; the text is the same.
  assert.deepEqual(ranges(await diff({ cwd, source: { kind: "staged" }, file: now.staged[0] })), []);

  await unstage({ cwd, files: now.staged });
  assert.deepEqual((await status({ cwd })).staged, []);
  assert.ok(existsSync(join(cwd, "c.txt"))); // unstaging leaves the working tree alone

  await discard({ cwd, files: now.changes, trash: false });
  now = await status({ cwd });
  assert.equal(readFileSync(join(cwd, "a.txt"), "utf8"), "one\n");
  assert.equal(existsSync(join(cwd, "new.txt")), false);
});

test("a conflict is listed apart and staging resolves it", async (t) => {
  const { cwd, git, write } = repository(t);
  write("a.txt", "base\n");
  git("add", ".");
  git("commit", "--quiet", "--message=base");
  git("switch", "--quiet", "--create", "side");
  write("a.txt", "side\n");
  git("commit", "--quiet", "--all", "--message=side");
  git("switch", "--quiet", "main");
  write("a.txt", "main\n");
  git("commit", "--quiet", "--all", "--message=main");
  assert.throws(() => git("merge", "--quiet", "side"));

  let now = await status({ cwd });
  assert.deepEqual(now.conflicts, [{ path: "a.txt", status: "U", conflict: "UU" }]);
  assert.deepEqual((await markers({ cwd, paths: ["a.txt"] })).paths, ["a.txt"]);
  write("a.txt", "main and side\n");
  assert.deepEqual((await markers({ cwd, paths: ["a.txt"] })).paths, []);
  write("a.txt", "both\n");
  await stage({ cwd, files: now.conflicts });
  now = await status({ cwd });
  assert.deepEqual(now.conflicts, []);
  assert.deepEqual(now.staged, [{ path: "a.txt", status: "M" }]);
});

test("history carries parents and refs, and a merge shows what it brought in", async (t) => {
  const { cwd, git, write } = repository(t);
  const at = (time: number) => Object.assign(process.env, { GIT_AUTHOR_DATE: `@${time} +0000`, GIT_COMMITTER_DATE: `@${time} +0000` });
  t.after(() => {
    delete process.env.GIT_AUTHOR_DATE;
    delete process.env.GIT_COMMITTER_DATE;
  });
  at(1000);
  write("a.txt", "a\n");
  git("add", ".");
  git("commit", "--quiet", "--message=root");
  git("tag", "v1");
  git("switch", "--quiet", "--create", "side");
  at(2000);
  write("side.txt", "side\n");
  git("add", ".");
  git("commit", "--quiet", "--message=on side");
  git("switch", "--quiet", "main");
  at(3000);
  write("a.txt", "a\nmain\n");
  git("commit", "--quiet", "--all", "--message=on main");
  at(4000);
  git("merge", "--quiet", "--no-ff", "--message=merge side", "side");
  git("switch", "--quiet", "--create", "later", "v1");
  at(5000);
  write("later.txt", "later\n");
  git("add", ".");
  git("commit", "--quiet", "--message=on later\n\nwith a body");
  git("switch", "--quiet", "main");

  const all = await log({ cwd, scope: "all", limit: 10 });
  assert.equal(all.more, false);
  assert.deepEqual(
    all.commits.map(({ subject, author, time, parents, refs }) => ({ subject, author, time, parents: parents.length, refs })),
    [
      { subject: "on later", author: "Ada", time: 5000, parents: 1, refs: [{ kind: "branch", name: "later" }] },
      { subject: "merge side", author: "Ada", time: 4000, parents: 2, refs: [{ kind: "head", name: "main" }] },
      { subject: "on main", author: "Ada", time: 3000, parents: 1, refs: [] },
      { subject: "on side", author: "Ada", time: 2000, parents: 1, refs: [{ kind: "branch", name: "side" }] },
      { subject: "root", author: "Ada", time: 1000, parents: 0, refs: [{ kind: "tag", name: "v1" }] },
    ],
  );

  // The checked-out branch alone: "later" is not part of it.
  const current = await log({ cwd, scope: "current", limit: 2 });
  assert.deepEqual(current.commits.map((c) => c.subject), ["merge side", "on main"]);
  assert.equal(current.more, true);

  const merge = await show({ cwd, hash: all.commits[1].hash });
  assert.equal(merge.message, "merge side");
  assert.deepEqual(merge.files, [{ path: "side.txt", status: "A" }]);
  // Counted as the files are, against the first parent; a count of nothing is zero.
  assert.deepEqual(merge.stats, { files: 1, insertions: 1, deletions: 0 });
  assert.deepEqual((await show({ cwd, hash: all.commits[2].hash })).stats, { files: 1, insertions: 1, deletions: 0 });
  assert.deepEqual(await diff({ cwd, source: { kind: "commit", hash: all.commits[1].hash }, file: merge.files[0] }), { kind: "file", lines: ["side", ""] });

  assert.equal((await show({ cwd, hash: all.commits[0].hash })).message, "on later\n\nwith a body");
  assert.deepEqual((await show({ cwd, hash: all.commits[4].hash })).files, [{ path: "a.txt", status: "A" }]);

  const before = (await status({ cwd })).refs;
  git("tag", "v2");
  assert.notEqual((await status({ cwd })).refs, before);
});

test("the ref picker limits matches, not the refs it searches", async (t) => {
  const { cwd, git } = repository(t);
  git("commit", "--quiet", "--allow-empty", "--message=root");
  const oid = git("rev-parse", "HEAD");
  const names = Array.from({ length: REF_SEARCH_LIMIT }, (_, n) => `refs/heads/archive/${String(n).padStart(4, "0")}`);
  execFileSync("git", ["update-ref", "--stdin"], { cwd, input: names.map((id) => `create ${id} ${oid}\n`).join("") });
  git("branch", "team/Release/topic");
  git("tag", "team/Release/topic");
  git("update-ref", "refs/remotes/origin/team/Release/topic", oid);
  git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/team/Release/topic");
  git("update-ref", "refs/remotes/other/head", oid);
  git("pack-refs", "--all");

  assert.deepEqual(await refs({ cwd, query: "" }), { refs: names, more: true });
  assert.deepEqual(await refs({ cwd, query: "archive" }), { refs: names, more: false });
  const matches = ["refs/heads/team/Release/topic", "refs/remotes/origin/team/Release/topic", "refs/tags/team/Release/topic"];
  for (const query of ["RELEASE", "m/relea", "lease/to", "TEAM/RELEASE/TOPIC"]) {
    assert.deepEqual(await refs({ cwd, query }), { refs: matches, more: false });
  }
  assert.deepEqual(await refs({ cwd, query: "head" }), { refs: ["refs/remotes/other/head"], more: false });
  // A hidden remote HEAD still counts toward truncation of the raw search.
  git("symbolic-ref", "refs/remotes/archive/HEAD", "refs/heads/main");
  assert.deepEqual(await refs({ cwd, query: "archive" }), { refs: names, more: true });
  for (const query of ["refs/heads", "*", "?", "[", "--count=1"]) {
    assert.deepEqual(await refs({ cwd, query }), { refs: [], more: false });
  }
  assert.equal(refsRpc.input.safeParse({ cwd, query: "a".repeat(MAX_REF_QUERY_LENGTH + 1) }).success, false);
});

test("manual history uses just the chosen ref IDs, pages commits and leaves the worktree alone", async (t) => {
  const { cwd, git, write } = repository(t);
  git("commit", "--quiet", "--allow-empty", "--message=root");
  git("tag", "--annotate", "release", "--message=tag");
  const remote = "refs/remotes/origin/release";
  git("update-ref", remote, git("commit-tree", "HEAD^{tree}", "-p", "HEAD", "-m", "remote"));
  git("commit", "--quiet", "--allow-empty", "--message=local");
  git("branch", "release");
  git("commit", "--quiet", "--allow-empty", "--message=checked out");
  write("dirty", "staged\n");
  git("add", "dirty");
  write("dirty", "unstaged\n");
  const snapshot = () => [git("symbolic-ref", "HEAD"), git("show-ref", "--head"), git("ls-files", "--stage"), readFileSync(join(cwd, "dirty"), "utf8")];
  const before = snapshot();
  const branch = "refs/heads/release", tag = "refs/tags/release";
  const read = (scope: string[], limit = 10) => log({ cwd, scope, limit });
  const subjects = (page: Awaited<ReturnType<typeof log>>) => page.commits.map((c) => c.subject);
  assert.deepEqual(subjects(await read([tag])), ["root"]);
  assert.deepEqual(subjects(await read([branch])), ["local", "root"]);
  assert.deepEqual(subjects(await read([remote])), ["remote", "root"]);
  const selected = [branch, remote, tag];
  const first = await read(selected, 2);
  const full = await read(selected, 3);
  assert.deepEqual(full.scope, selected);
  assert.deepEqual(subjects(full).sort(), ["local", "remote", "root"]);
  assert.deepEqual(first.commits, full.commits.slice(0, 2));
  assert.equal(first.more, true);
  assert.equal(full.more, false);
  assert.deepEqual(snapshot(), before);
});

test("a saved filter drops missing IDs exactly, returning Auto only when none survive", async (t) => {
  const { cwd, git } = repository(t);
  const stale = "refs/heads/topic", kept = "refs/tags/topic";
  git("commit", "--quiet", "--allow-empty", "--message=root");
  git("branch", "topic");
  git("tag", "topic");
  const read = (scope: string[]) => log({ cwd, scope, limit: 10 });
  assert.deepEqual((await read([stale, kept])).scope, [stale, kept]);
  git("update-ref", "-d", stale);
  git("commit", "--quiet", "--allow-empty", "--message=current");
  git("branch", "topic/child");
  git("branch", "refs/heads/topic"); // revision parsing would find this short name for the deleted full ID
  const partial = await read([stale, kept, kept]);
  assert.deepEqual(partial.scope, [kept]);
  assert.deepEqual(partial.commits.map((c) => c.subject), ["root"]);
  git("tag", "--delete", "topic");
  const auto = await log({ cwd, scope: "current", limit: 10 });
  assert.equal(auto.scope, "current");
  assert.deepEqual(await read([stale, kept]), auto);
  assert.deepEqual(await read([]), auto);
});

test("the ref contract rejects revision expressions, flags and unsupported namespaces", async (t) => {
  const { cwd } = repository(t);
  for (const id of ["HEAD", "--all", "main", "refs/stash", "refs/heads/a..b", "refs/heads/a~1", "refs/heads/a^", "refs/tags/v^{commit}",
    "refs/heads/main@{1}", "refs/heads/main:file", "refs/heads/m*", "refs/heads/.hidden", "refs/heads/space here", "refs/heads/a\nb"]) {
    const input = { cwd, scope: [id], limit: 1 };
    assert.equal(logRpc.input.safeParse(input).success, false, id);
    await assert.rejects(log(input));
  }
  assert.equal(logRpc.input.safeParse({ cwd, limit: 1, scope: Array(MAX_SELECTED_REFS + 1).fill("refs/heads/main") }).success, false);
});

test("without a HEAD commit, Auto is empty but a selected tag can still have history", async (t) => {
  const { cwd, git } = repository(t);
  assert.deepEqual(await refs({ cwd, query: "" }), { refs: [], more: false });
  assert.deepEqual(await log({ cwd, scope: ["refs/heads/missing"], limit: 10 }), { scope: "current", commits: [], more: false, sync: null });
  git("commit", "--quiet", "--allow-empty", "--message=tagged");
  git("tag", "keep");
  git("symbolic-ref", "HEAD", "refs/heads/unborn");
  assert.deepEqual((await log({ cwd, scope: "current", limit: 10 })).commits, []);
  for (const scope of ["all" as const, ["refs/tags/keep"]]) {
    const page = await log({ cwd, scope, limit: 10 });
    assert.deepEqual(page.scope, scope);
    assert.deepEqual(page.commits.map((c) => c.subject), ["tagged"]);
  }
});

test("the branch a branch was made from, found as VS Code finds it, and Auto showing it", async (t) => {
  const { cwd, git, write } = repository(t);
  write("a.txt", "a\n");
  git("add", ".");
  git("commit", "--quiet", "--message=root");
  // A remote whose default branch main follows, and another branch on it.
  git("remote", "add", "origin", "https://example.com/r.git");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  git("branch", "--quiet", "--set-upstream-to=origin/main");
  git("switch", "--quiet", "--create", "other");
  write("b.txt", "b\n");
  git("add", ".");
  git("commit", "--quiet", "--message=on other");
  git("update-ref", "refs/remotes/origin/other", "HEAD");
  git("switch", "--quiet", "main");

  // The default branch is main's own upstream: nothing more to show.
  let now = await status({ cwd });
  assert.equal(now.upstream, "origin/main");
  assert.equal(now.base, null);

  // Created from a branch on the remote, without following it.
  git("switch", "--quiet", "--no-track", "--create", "feature", "origin/main");
  now = await status({ cwd });
  assert.equal(now.upstream, null);
  assert.equal(now.base, "origin/main");

  // Created from a local branch: the branch that one follows.
  git("branch", "--quiet", "--set-upstream-to=origin/other", "other");
  git("switch", "--quiet", "--create", "topic", "other");
  assert.equal(await baseOf(cwd, "topic"), "origin/other");

  // Created from HEAD: the branch HEAD moved away from.
  git("switch", "--quiet", "other");
  git("switch", "--quiet", "--create", "deep");
  assert.equal(await baseOf(cwd, "deep"), "origin/other");

  // Neither: the remote's default branch.
  git("checkout", "--quiet", "--detach");
  git("switch", "--quiet", "--create", "loose");
  assert.equal(await baseOf(cwd, "loose"), "origin/main");

  // What VS Code keeps in the branch's config comes first, but only a branch on a remote counts.
  git("config", "branch.feature.vscode-merge-base", "other");
  assert.equal(await baseOf(cwd, "feature"), "origin/main");
  git("config", "branch.feature.vscode-merge-base", "origin/other");
  assert.equal(await baseOf(cwd, "feature"), "origin/other");

  // Auto shows the base's history beside the branch's own.
  git("switch", "--quiet", "feature");
  const auto = await log({ cwd, scope: "current", limit: 10 });
  assert.deepEqual(
    auto.commits.map((c) => c.subject),
    ["on other", "root"],
  );
});

test("where the branch and its upstream parted, and what a pull and a push would carry", async (t) => {
  const { cwd, git, write } = repository(t);
  write("a.txt", "a\n");
  git("add", ".");
  git("commit", "--quiet", "--message=root");
  const root = git("rev-parse", "HEAD");

  // No upstream: nothing to pull or push.
  assert.equal((await log({ cwd, scope: "all", limit: 10 })).sync, null);

  git("remote", "add", "origin", "https://example.com/r.git");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  git("branch", "--quiet", "--set-upstream-to=origin/main");
  // Level with its upstream: nothing either.
  assert.equal((await log({ cwd, scope: "all", limit: 10 })).sync, null);

  // A commit on the branch, and another that a fetch brought to the upstream.
  write("mine.txt", "mine\n");
  git("add", ".");
  git("commit", "--quiet", "--message=mine");
  const head = git("rev-parse", "HEAD");
  git("checkout", "--quiet", "--detach", root);
  write("a.txt", "theirs\n");
  git("commit", "--quiet", "--all", "--message=theirs");
  const upstream = git("rev-parse", "HEAD");
  git("update-ref", "refs/remotes/origin/main", upstream);
  git("switch", "--quiet", "main");

  const { sync } = await log({ cwd, scope: "current", limit: 10 });
  assert.deepEqual(sync, { head, upstream, base: root });
  const localId = "refs/heads/main", remoteId = "refs/remotes/origin/main";
  git("tag", "main", head); // same name and same tip as the checked-out branch, but not its ID
  git("tag", "remote", upstream);
  const manual = async (...scope: string[]) => (await log({ cwd, scope, limit: 10 })).sync;
  assert.equal(await manual("refs/tags/main", "refs/tags/remote"), null);
  assert.deepEqual(await manual(localId, "refs/tags/remote"), { ...sync, showIncoming: false });
  assert.deepEqual(await manual(remoteId, "refs/tags/main"), { ...sync, showOutgoing: false });
  assert.deepEqual(await manual(localId, remoteId), sync);
  const incoming = await compare({ cwd, from: root, to: upstream });
  assert.deepEqual(incoming.files, [{ path: "a.txt", status: "M" }]);
  assert.deepEqual(ranges(await diff({ cwd, source: { kind: "incoming", from: root, to: upstream }, file: incoming.files[0] })), [[[1, 2], [1, 2]]]);
  const outgoing = await compare({ cwd, from: root, to: head });
  assert.deepEqual(outgoing.files, [{ path: "mine.txt", status: "A" }]);
});

test("an untracked file that has gone is an error, not an empty diff", async (t) => {
  const { cwd } = repository(t);
  await assert.rejects(diff({ cwd, source: { kind: "changes" }, file: { path: "gone.txt", status: "?" } }), /ENOENT/);
});

test("amending folds what is staged into the last commit, and rewords it when there is a message", async (t) => {
  const { cwd, git, write } = repository(t);
  write("a.txt", "one\n");
  git("add", ".");
  git("commit", "--quiet", "--message=first");
  write("b.txt", "two\n");
  await stage({ cwd, files: [{ path: "b.txt", status: "?" }] });

  await commit({ cwd, message: "", amend: true, all: false });
  assert.equal(git("log", "--format=%s"), "first");
  assert.equal(git("show", "--format=", "--name-only"), "a.txt\nb.txt");

  await commit({ cwd, message: "first, reworded", amend: true, all: false });
  assert.equal(git("log", "--format=%s"), "first, reworded");
});

test("git's own message comes back when it refuses", async (t) => {
  const { cwd } = repository(t);
  await assert.rejects(commit({ cwd, message: "nothing staged", amend: false, all: false }), /nothing to commit|no changes added|Initial commit/i);
  await assert.rejects(status({ cwd: tmpdir() }), /not a git repository/);
});

test("as in VS Code, no more than 10000 files are listed, and an unignored node_modules is offered to be ignored", async (t) => {
  const { cwd, write } = repository(t);
  mkdirSync(join(cwd, "node_modules"));
  for (let n = 0; n <= 10_000; n++) write(`node_modules/file ${n}.txt`, "");

  let now = await status({ cwd });
  assert.equal(now.cutAt, 10_000);
  assert.equal(now.changes.length, 10_000);
  assert.deepEqual(now.hugeFolders, ["node_modules"]);

  await ignore({ cwd, paths: ["node_modules"] });
  assert.equal(readFileSync(join(cwd, ".gitignore"), "utf8"), "node_modules\n");
  now = await status({ cwd });
  assert.deepEqual([now.cutAt, now.changes, now.hugeFolders], [null, [{ path: ".gitignore", status: "?" }], []]);
});

test("a .gitignore without a newline at its end gets one before what is added", async (t) => {
  const { cwd, write } = repository(t);
  write(".gitignore", "dist");
  await ignore({ cwd, paths: ["node_modules", "a[1].txt"] });
  assert.equal(readFileSync(join(cwd, ".gitignore"), "utf8"), "dist\nnode_modules\na\\[1].txt\n");
});

test("more paths than one command line holds are staged a part at a time", async (t) => {
  const { cwd, git, write } = repository(t);
  const long = "x".repeat(100);
  for (let n = 0; n < 400; n++) write(`${long}-${n}.txt`, ""); // 40000 characters of paths
  await stage({ cwd, files: (await status({ cwd })).changes });
  assert.equal(git("diff", "--cached", "--name-only").split("\n").length, 400);
});

test("a file deleted by them and modified by us can be deleted, as VS Code's Delete File does", async (t) => {
  const { cwd, git, write } = repository(t);
  write("a.txt", "base\n");
  git("add", ".");
  git("commit", "--quiet", "--message=base");
  git("switch", "--quiet", "--create", "side");
  git("rm", "--quiet", "a.txt");
  git("commit", "--quiet", "--message=gone");
  git("switch", "--quiet", "main");
  write("a.txt", "main\n");
  git("commit", "--quiet", "--all", "--message=main");
  assert.throws(() => git("merge", "--quiet", "side"));

  const { conflicts } = await status({ cwd });
  assert.deepEqual(conflicts, [{ path: "a.txt", status: "U", conflict: "UD" }]);
  await remove({ cwd, files: conflicts });
  assert.deepEqual((await status({ cwd })).conflicts, []);
  assert.equal(existsSync(join(cwd, "a.txt")), false);
});

test("an untracked file the Trash cannot take is left, and said so", async (t) => {
  const { cwd } = repository(t);
  // A file that is not there fails the Trash without putting anything in it.
  assert.deepEqual(await discard({ cwd, files: [{ path: "gone.txt", status: "?" }], trash: true }), { trashFailed: true });
});

test("as in VS Code, a changed line marks the words that changed in it", async (t) => {
  const { cwd, git, write } = repository(t);
  write("abstract.tex", "Intro.\nMost fail. We compared versions of the evaluator.\nEnd.\n");
  git("add", ".");
  git("commit", "--quiet", "--message=first");
  write("abstract.tex", "Intro.\nMost fail. On a 36-task audit subset, we compared versions of the evaluator.\nEnd.\n");
  const result = await diff({ cwd, source: { kind: "changes" }, file: { path: "abstract.tex", status: "M" } });
  assert.equal(result.kind, "diff");
  if (result.kind !== "diff") return;
  const text = (lines: string[], [line, start, , end]: number[]) => lines[line - 1].slice(start - 1, end - 1);
  assert.deepEqual(
    result.changes.flatMap((change) => change.inner.map((inner) => [text(result.original, inner.original), text(result.modified, inner.modified)])),
    [["We", "On a 36-task audit subset, we"]],
  );
});

test("a binary file is not compared", async (t) => {
  const { cwd, write } = repository(t);
  write("image.bin", "\0\x01\x02");
  assert.deepEqual(await diff({ cwd, source: { kind: "changes" }, file: { path: "image.bin", status: "?" } }), { kind: "binary" });
});

test("Publish Branch makes the remote's branch the upstream; Sync Changes pulls, then pushes what the branch had", async (t) => {
  const { cwd, git, write } = repository(t);
  const bare = mkdtempSync(join(tmpdir(), "source-control-remote-"));
  t.after(() => rmSync(bare, { recursive: true, force: true }));
  execFileSync("git", ["init", "--quiet", "--bare", "--initial-branch=main"], { cwd: bare });
  git("config", "pull.rebase", "false"); // as most set it: git refuses to pull a branch that parted from its upstream otherwise
  write("a.txt", "a\n");
  git("add", ".");
  git("commit", "--quiet", "--message=root");
  git("remote", "add", "origin", bare);
  assert.deepEqual(await remotes({ cwd }), { remotes: ["origin"] });

  await sync({ cwd, action: "publish", remote: "origin" });
  assert.equal((await status({ cwd })).upstream, "origin/main");

  // Someone else pushes a commit, and this branch makes one of its own.
  const other = mkdtempSync(join(tmpdir(), "source-control-other-"));
  t.after(() => rmSync(other, { recursive: true, force: true }));
  execFileSync("git", ["clone", "--quiet", bare, other]);
  writeFileSync(join(other, "theirs.txt"), "theirs\n");
  execFileSync("git", ["add", "."], { cwd: other });
  execFileSync("git", ["commit", "--quiet", "--message=theirs"], { cwd: other });
  execFileSync("git", ["push", "--quiet"], { cwd: other });
  write("mine.txt", "mine\n");
  git("add", ".");
  git("commit", "--quiet", "--message=mine");
  git("fetch", "--quiet");
  const before = await status({ cwd });
  assert.deepEqual([before.ahead, before.behind], [1, 1]);

  await sync({ cwd, action: "sync" });
  const after = await status({ cwd });
  assert.deepEqual([after.ahead, after.behind], [0, 0]);
  const pushed = execFileSync("git", ["log", "--format=%s", "main"], { cwd: bare, encoding: "utf8" });
  assert.match(pushed, /mine/);
  assert.match(pushed, /theirs/);
});

test("a merge under way: VS Code's Continue commits it, starting from git's merge message", async (t) => {
  const { cwd, git, write } = repository(t);
  write("a.txt", "base\n");
  git("add", ".");
  git("commit", "--quiet", "--message=base");
  git("switch", "--quiet", "--create", "side");
  write("a.txt", "side\n");
  git("commit", "--quiet", "--all", "--message=side");
  git("switch", "--quiet", "main");
  write("a.txt", "main\n");
  git("commit", "--quiet", "--all", "--message=main");
  assert.throws(() => git("merge", "--quiet", "side"));

  let now = await status({ cwd });
  assert.equal(now.operation, "merge");
  assert.equal(now.template, "Merge branch 'side'"); // the comments git adds below it left out
  write("a.txt", "both\n");
  await stage({ cwd, files: now.conflicts });
  await commit({ cwd, message: now.template, amend: false, all: false });
  now = await status({ cwd });
  assert.deepEqual([now.operation, now.template], [null, ""]);
  assert.equal(git("log", "-1", "--format=%s"), "Merge branch 'side'");
});

test("a rebase under way: the commit box holds the commit being applied, and Continue goes on with the rebase", async (t) => {
  const { cwd, git, write } = repository(t);
  write("a.txt", "base\n");
  git("add", ".");
  git("commit", "--quiet", "--message=base");
  git("switch", "--quiet", "--create", "side");
  write("a.txt", "side\n");
  git("commit", "--quiet", "--all", "--message=side's change");
  git("switch", "--quiet", "main");
  write("a.txt", "main\n");
  git("commit", "--quiet", "--all", "--message=main");
  git("switch", "--quiet", "side");
  assert.throws(() => git("rebase", "--quiet", "main"));

  let now = await status({ cwd });
  assert.deepEqual([now.operation, now.rebaseMessage], ["rebase", "side's change"]);
  write("a.txt", "main and side\n");
  await stage({ cwd, files: now.conflicts });
  await commit({ cwd, message: now.rebaseMessage!, amend: false, all: false });
  now = await status({ cwd });
  assert.deepEqual([now.operation, now.rebaseMessage, now.branch], [null, null, "side"]);
  assert.equal(git("log", "-1", "--format=%s"), "side's change");
});

test("committing everything, as VS Code offers when nothing is staged, and the commit template", async (t) => {
  const { cwd, git, write } = repository(t);
  write("template.txt", "# what changed\nfix: \n");
  git("config", "commit.template", "template.txt"); // from the repository's root
  assert.equal((await status({ cwd })).template, "fix:");
  write("a.txt", "a\n");
  await commit({ cwd, message: "everything", amend: false, all: true });
  const now = await status({ cwd });
  assert.deepEqual([now.staged, now.changes], [[], []]);
  assert.equal(git("show", "--name-only", "--format=", "HEAD"), "a.txt\ntemplate.txt");
});
