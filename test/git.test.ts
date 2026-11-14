// Runs the daemon half against throwaway repositories.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const { baseOf, commit, diff, discard, log, show, stage, status, unstage } = await import("../server/git.ts");

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
  const untracked = await diff({ cwd, source: { kind: "changes" }, file: now.changes[0] });
  assert.match(untracked.diff, /^\+hello$/m);

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
  assert.match((await diff({ cwd, source: { kind: "changes" }, file: now.changes[0] })).diff, /^\+more$/m);
  assert.match((await diff({ cwd, source: { kind: "staged" }, file: now.staged[0] })).diff, /^rename from b\.txt$/m);

  await unstage({ cwd, files: now.staged });
  assert.deepEqual((await status({ cwd })).staged, []);
  assert.ok(existsSync(join(cwd, "c.txt"))); // unstaging leaves the working tree alone

  await discard({ cwd, files: now.changes });
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
  assert.deepEqual(now.conflicts, [{ path: "a.txt", status: "U" }]);
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
  const patch = await diff({ cwd, source: { kind: "commit", hash: all.commits[1].hash }, file: merge.files[0] });
  assert.match(patch.diff, /^\+side$/m);

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

test("an untracked file that has gone is an error, not an empty diff", async (t) => {
  const { cwd } = repository(t);
  await assert.rejects(diff({ cwd, source: { kind: "changes" }, file: { path: "gone.txt", status: "?" } }), /Could not access/);
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
