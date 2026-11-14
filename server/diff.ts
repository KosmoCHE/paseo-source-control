// Compares two versions of a file as VS Code's diff editor does: with its own algorithm, from the vscode-diff package
// (the same results as VS Code 1.142's on the files tried), and the editor's defaults. A file that is there on one side
// only is shown as itself, as VS Code opens it.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import { DefaultLinesDiffComputer } from "vscode-diff";
import type { DiffSource, FileChange, diffRpc } from "../shared/git";
import { git } from "./git.ts"; // with its extension, so that the tests can load this module without a bundler

// diffEditor.ignoreTrimWhitespace, diffEditor.maxComputationTime and diffEditor.experimental.showMoves, as VS Code sets them.
const OPTIONS = { ignoreTrimWhitespace: true, maxComputationTimeMs: 5000, computeMoves: false };

/** Where one side of a file is read: a revision of it, "" being the index, or the working tree. */
type Side = { revision: string; path: string } | { worktree: string };

/** The two sides VS Code compares for a file; null where the file is not on that side. */
function sides(source: DiffSource, file: FileChange): [Side | null, Side | null] {
  const { path, status } = file;
  const before = file.from ?? path; // a rename's old path
  const at = (revision: string, where = path): Side => ({ revision, path: where });
  const between = (from: string, to: string): [Side | null, Side | null] =>
    status === "A" ? [null, at(to)] : status === "D" ? [at(from), null] : [at(from, before), at(to)];
  if (source.kind === "changes") {
    // An untracked file, and one in conflict with its markers, open as they are in the working tree.
    if (status === "?" || status === "U") return [null, { worktree: path }];
    return status === "D" ? [at(""), null] : [at("", before), { worktree: path }];
  }
  if (source.kind === "staged") return between("HEAD", "");
  if (source.kind === "commit") return between(`${source.hash}^`, source.hash); // a merge against its first parent
  return between(source.from, source.to);
}

async function read(cwd: string, side: Side) {
  if ("worktree" in side) return readFile(join(cwd, side.worktree), "utf8");
  return git(cwd, ["show", `${side.revision}:${side.path}`]);
}

const binary = (text: string) => text.slice(0, 8000).includes("\0"); // git's own test
const lines = (text: string) => text.split(/\r\n|\r|\n/);

export async function diff({ cwd, source, file }: RpcInput<typeof diffRpc>): Promise<RpcOutput<typeof diffRpc>> {
  const [from, to] = sides(source, file);
  const [original, modified] = await Promise.all([from && read(cwd, from), to && read(cwd, to)]);
  if ([original, modified].some((text) => text !== null && binary(text))) return { kind: "binary" };
  if (original === null || modified === null) return { kind: "file", lines: lines(original ?? modified ?? "") };
  const [before, after] = [lines(original), lines(modified)];
  const result = new DefaultLinesDiffComputer().computeDiff(before, after, OPTIONS);
  const range = (r: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }) =>
    [r.startLineNumber, r.startColumn, r.endLineNumber, r.endColumn] as [number, number, number, number];
  return {
    kind: "diff",
    original: before,
    modified: after,
    hitTimeout: result.hitTimeout,
    changes: result.changes.map((change) => ({
      original: [change.original.startLineNumber, change.original.endLineNumberExclusive],
      modified: [change.modified.startLineNumber, change.modified.endLineNumberExclusive],
      inner: (change.innerChanges ?? []).map((inner) => ({ original: range(inner.originalRange), modified: range(inner.modifiedRange) })),
    })),
  };
}
