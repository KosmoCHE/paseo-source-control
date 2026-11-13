// Looks for repositories in throwaway folders, against what VS Code lists for the same layout.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test, type TestContext } from "node:test";

Object.assign(process.env, { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" });
const { repositories } = await import("../server/repositories.ts");

/** A temporary folder. `repo` makes a repository below it, `settings` writes its .vscode/settings.json. */
function workspace(t: TestContext) {
  const top = realpathSync(mkdtempSync(join(tmpdir(), "git-graph-")));
  t.after(() => rmSync(top, { recursive: true, force: true }));
  const at = (path: string) => join(top, path);
  const folder = (path: string) => mkdirSync(at(path), { recursive: true });
  const repo = (path: string) => {
    folder(path);
    execFileSync("git", ["init", "--quiet", "--initial-branch=main"], { cwd: at(path) });
  };
  const settings = (path: string, text: string) => {
    folder(join(path, ".vscode"));
    writeFileSync(at(join(path, ".vscode", "settings.json")), text);
  };
  /** What is listed for a folder, by path below the temporary folder. */
  const list = async (path: string) => {
    const found = await repositories({ cwd: at(path) });
    const below = (root: string) => root.slice(top.length + 1) || ".";
    return { listed: found.repositories.map((repository) => below(repository.root)), offered: found.parent && below(found.parent.root) };
  };
  return { top, at, folder, repo, settings, list };
}

test("the folder's own repository and those one level down", async (t) => {
  const { repo, folder, list, top } = workspace(t);
  repo(".");
  repo("b");
  repo("a");
  repo("a/nested"); // two levels down
  repo("node_modules/package"); // inside an ignored folder
  folder("plain");
  assert.deepEqual(await list("."), { listed: [".", "a", "b"], offered: null });

  const [own] = (await repositories({ cwd: top })).repositories;
  // The repositories below are untracked folders to this one, and so changes.
  assert.deepEqual(own, { root: top, name: top.slice(dirname(top).length + 1), branch: "main", head: null, upstream: null, ahead: 0, behind: 0, changed: true, staged: false, merging: false });
});

test("a folder inside a repository lists what is below it, and only offers the repository above", async (t) => {
  const { repo, folder, list } = workspace(t);
  repo("outer");
  folder("outer/work/notes");
  repo("outer/work/child");
  assert.deepEqual(await list("outer/work"), { listed: ["outer/work/child"], offered: "outer" });
  assert.deepEqual(await list("outer/work/notes"), { listed: [], offered: "outer" });
});

test("the folder's settings: no scanning, and the repositories it names", async (t) => {
  const { repo, folder, settings, list } = workspace(t);
  repo(".");
  repo("a"); // one level down, but scanning is off
  repo("deep/er/repo");
  folder("deep/er/repo/src");
  folder("plain");
  settings(
    ".",
    `{
      // only the repositories named here
      "git.repositoryScanMaxDepth": 0,
      "git.autoRepositoryDetection": "subFolders",
      "git.scanRepositories": [
        "deep/er/repo/src", /* a folder inside a repository stands for that repository */
        "plain",
        "missing",
      ],
      "editor.tabSize": 2
    }`,
  );
  assert.deepEqual(await list("."), { listed: [".", "deep/er/repo"], offered: null });
});

test("deeper scanning, ignored repositories, and repositories above the folder", async (t) => {
  const { repo, settings, list } = workspace(t);
  repo("outer");
  repo("outer/work/a");
  repo("outer/work/a/nested");
  repo("outer/work/b");

  settings("outer/work", `{ "git.repositoryScanMaxDepth": -1, "git.ignoredRepositories": ["b"], "git.openRepositoryInParentFolders": "always" }`);
  assert.deepEqual(await list("outer/work"), { listed: ["outer", "outer/work/a", "outer/work/a/nested"], offered: null });

  settings("outer/work", `{ "git.openRepositoryInParentFolders": "never" }`);
  assert.deepEqual(await list("outer/work"), { listed: ["outer/work/a", "outer/work/b"], offered: null });

  settings("outer/work", `{ "git.autoRepositoryDetection": false }`);
  assert.deepEqual(await list("outer/work"), { listed: [], offered: "outer" });
});

test("a detached HEAD has no branch", async (t) => {
  const { repo, at, top } = workspace(t);
  repo(".");
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=Ada", "-c", "user.email=ada@example.com", ...args], { cwd: at(".") });
  git("commit", "--quiet", "--allow-empty", "--message=first");
  git("switch", "--quiet", "--detach");
  const [detached] = (await repositories({ cwd: top })).repositories;
  assert.equal(detached.branch, null);
  assert.equal(detached.head, git("rev-parse", "HEAD").toString().trim());
});

test("how far a branch is from its upstream", async (t) => {
  const { repo, at, top } = workspace(t);
  repo("origin");
  const git = (path: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=Ada", "-c", "user.email=ada@example.com", ...args], { cwd: at(path) });
  const commit = (path: string, message: string) => git(path, "commit", "--quiet", "--allow-empty", `--message=${message}`);
  commit("origin", "first");
  git(".", "clone", "--quiet", "origin", "clone");
  commit("origin", "theirs");
  commit("origin", "theirs too");
  commit("clone", "mine");

  const read = async () => {
    const { upstream, ahead, behind } = (await repositories({ cwd: top })).repositories.find((repository) => repository.name === "clone")!;
    return { upstream, ahead, behind };
  };
  assert.deepEqual(await read(), { upstream: "origin/main", ahead: 1, behind: 0 }); // what the upstream has gained is not known before a fetch
  git("clone", "fetch", "--quiet");
  assert.deepEqual(await read(), { upstream: "origin/main", ahead: 1, behind: 2 });
});

test("what is pending, as VS Code marks it beside the branch", async (t) => {
  const { repo, at, top } = workspace(t);
  repo(".");
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=Ada", "-c", "user.email=ada@example.com", ...args], { cwd: top, stdio: "pipe" });
  const read = async () => {
    const { changed, staged, merging } = (await repositories({ cwd: top })).repositories[0];
    return { changed, staged, merging };
  };
  writeFileSync(at("file.txt"), "first\n");
  assert.deepEqual(await read(), { changed: true, staged: false, merging: false }); // untracked
  git("add", "file.txt");
  assert.deepEqual(await read(), { changed: false, staged: true, merging: false });
  git("commit", "--quiet", "--message=first");
  assert.deepEqual(await read(), { changed: false, staged: false, merging: false });

  git("switch", "--quiet", "--create", "other");
  writeFileSync(at("file.txt"), "theirs\n");
  git("commit", "--quiet", "--all", "--message=theirs");
  git("switch", "--quiet", "main");
  writeFileSync(at("file.txt"), "ours\n");
  git("commit", "--quiet", "--all", "--message=ours");
  assert.throws(() => git("merge", "other")); // a conflict
  assert.deepEqual(await read(), { changed: false, staged: false, merging: true }); // the file in conflict is neither changed nor staged
  git("merge", "--abort");
  assert.deepEqual(await read(), { changed: false, staged: false, merging: false });
});

test("a settings file that cannot be used is reported", async (t) => {
  const { repo, settings, list } = workspace(t);
  repo(".");
  settings(".", `{ "git.scanRepositories": [ `);
  await assert.rejects(list("."), /settings\.json cannot be read/);
  settings(".", `{ "git.scanRepositories": "claude-plugins" }`);
  await assert.rejects(list("."), /settings\.json: .*git\.scanRepositories/s);
});
