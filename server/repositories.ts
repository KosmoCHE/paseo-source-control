// Finds a workspace folder's repositories the way VS Code's git extension does, reading the
// same settings from the folder's .vscode/settings.json:
//
// - the repository at the folder itself;
// - the repositories in its subfolders, `git.repositoryScanMaxDepth` levels down;
// - the repositories named in `git.scanRepositories`;
// - none of those in `git.ignoredRepositories`;
// - a repository whose root lies above the folder only under
//   `git.openRepositoryInParentFolders: "always"`. Otherwise it is offered, unless "never".

import { existsSync } from "node:fs";
import { readFile, readdir, realpath } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import stripJsonComments from "strip-json-comments";
import { z } from "zod";
import type { repositoriesRpc } from "../shared/git";
import { git } from "./git.ts"; // with its extension, so that the tests can load this module without a bundler

// VS Code's own defaults.
const settingsSchema = z.object({
  "git.autoRepositoryDetection": z.union([z.boolean(), z.enum(["subFolders", "openEditors"])]).default(true),
  "git.repositoryScanMaxDepth": z.number().int().default(1), // -1: no limit
  "git.repositoryScanIgnoredFolders": z.array(z.string()).default(["node_modules"]),
  "git.scanRepositories": z.array(z.string()).default([]),
  "git.ignoredRepositories": z.array(z.string()).default([]),
  "git.openRepositoryInParentFolders": z.enum(["always", "never", "prompt"]).default("prompt"),
});

/** The folder's own settings file is JSON with comments, and need not exist. */
async function readSettings(folder: string) {
  const file = join(folder, ".vscode", "settings.json");
  if (!existsSync(file)) return settingsSchema.parse({});
  let settings: unknown;
  try {
    // A file holding nothing but comments is an empty one, as it is to VS Code.
    settings = JSON.parse(stripJsonComments(await readFile(file, "utf8"), { trailingCommas: true }).trim() || "{}");
  } catch (error) {
    throw new Error(`${file} cannot be read: ${(error as Error).message}`, { cause: error });
  }
  const checked = settingsSchema.safeParse(settings);
  if (!checked.success) throw new Error(`${file}: ${z.prettifyError(checked.error)}`);
  return checked.data;
}

/** The root of the repository a path lies in. */
function enclosing(path: string): string | null {
  for (let folder = path; ; folder = dirname(folder)) {
    if (existsSync(join(folder, ".git"))) return folder;
    if (folder === dirname(folder)) return null;
  }
}

/** The repositories below a folder, `depth` levels down. */
async function scan(folder: string, depth: number, ignored: string[]): Promise<string[]> {
  const found: string[] = [];
  const queue = [{ path: folder, level: 0 }];
  for (const { path, level } of queue) {
    if (level > 0 && existsSync(join(path, ".git"))) found.push(path);
    if (depth !== -1 && level >= depth) continue;
    let entries;
    try {
      entries = await readdir(path, { withFileTypes: true });
    } catch (error) {
      console.warn(`Not scanned for repositories: ${path}: ${(error as Error).message}`); // one unreadable folder does not hide the rest
      continue;
    }
    const names = entries.filter((entry) => entry.isDirectory() && entry.name !== ".git" && !ignored.includes(entry.name)).map((entry) => entry.name);
    for (const name of names.sort()) queue.push({ path: join(path, name), level: level + 1 });
  }
  return found;
}

export async function repositories({ cwd }: RpcInput<typeof repositoriesRpc>): Promise<RpcOutput<typeof repositoriesRpc>> {
  const folder = await realpath(cwd);
  const settings = await readSettings(folder);
  const detection = settings["git.autoRepositoryDetection"];

  const roots = new Set<string>(); // in the order they are listed
  const add = (root: string | null) => root !== null && roots.add(root);
  add(enclosing(folder));
  if (detection === true || detection === "subFolders") {
    for (const root of await scan(folder, settings["git.repositoryScanMaxDepth"], settings["git.repositoryScanIgnoredFolders"])) add(root);
    for (const path of settings["git.scanRepositories"]) add(enclosing(resolve(folder, path)));
  }
  for (const path of settings["git.ignoredRepositories"]) roots.delete(resolve(folder, path));

  const describe = async (root: string) => ({ root, name: basename(root), branch: (await git(root, ["branch", "--show-current"])).trim() || null });
  const inside = (root: string) => root === folder || root.startsWith(folder + sep);
  const parents = settings["git.openRepositoryInParentFolders"];
  const listed = [...roots].filter((root) => parents === "always" || inside(root));
  const offered = parents === "prompt" ? [...roots].find((root) => !inside(root)) : undefined;
  return {
    repositories: await Promise.all(listed.map(describe)),
    parent: offered === undefined ? null : await describe(offered),
  };
}
