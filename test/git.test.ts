// Runs the daemon half against throwaway repositories.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

// The module reads the environment once: keep the user's git config, hooks and signing out of it.
Object.assign(process.env, {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Ada",
  GIT_AUTHOR_EMAIL: "ada@example.com",
  GIT_COMMITTER_NAME: "Ada",
  GIT_COMMITTER_EMAIL: "ada@example.com",
});
const { baseOf, commit, compare, discard, ignore, log, markers, remove, show, stage, status, unstage } = await import("../server/git.ts");
const { diff } = await import("../server/diff.ts");

/** The line ranges of a diff's changes, before and after. */
const ranges = (result: Awaited<ReturnType<typeof diff>>) => (result.kind === "diff" ? result.changes.map((change) => [change.original, change.modified]) : result.kind);

function repository(t: TestContext) {
  const cwd = mkdtempSync(join(tmpdir(), "source-control-"));
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
  await commit({ cwd, message: "first", amend: false });
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

  await commit({ cwd, message: "", amend: true });
  assert.equal(git("log", "--format=%s"), "first");
  assert.equal(git("show", "--format=", "--name-only"), "a.txt\nb.txt");

  await commit({ cwd, message: "first, reworded", amend: true });
  assert.equal(git("log", "--format=%s"), "first, reworded");
});

test("git's own message comes back when it refuses", async (t) => {
  const { cwd } = repository(t);
  await assert.rejects(commit({ cwd, message: "nothing staged", amend: false }), /nothing to commit|no changes added|Initial commit/i);
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
