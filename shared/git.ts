// The contract between the panel and the daemon half, which runs git.
//
// `git.repositories` takes a workspace's folder and lists the repositories in it. Git names
// files relative to a repository's root, so every other call takes such a root as its `cwd`.

import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const hash = z.string().regex(/^[0-9a-f]{40,64}$/);
const nothing = z.object({});

export const fileSchema = z.object({
  path: z.string(),
  from: z.string().optional(), // a rename's old path
  status: z.string(), // one letter: M A D R C T, U for a conflict, ? for untracked
});
export type FileChange = z.infer<typeof fileSchema>;

export const refSchema = z.object({
  kind: z.enum(["head", "branch", "remote", "tag"]), // head: the checked-out branch, or a detached HEAD
  name: z.string(),
});
export type Ref = z.infer<typeof refSchema>;

export const commitSchema = z.object({
  hash,
  parents: z.array(hash),
  author: z.string(),
  time: z.number(), // author time, seconds since the epoch
  subject: z.string(),
  refs: z.array(refSchema),
});
export type Commit = z.infer<typeof commitSchema>;

export const repositorySchema = z.object({
  root: z.string(),
  name: z.string(),
  branch: z.string().nullable(), // null when HEAD is detached
  head: z.string().nullable(), // the checked-out commit; null before the first one
  upstream: z.string().nullable(), // the branch it follows on a remote, if any
  ahead: z.number(), // commits the upstream lacks, and
  behind: z.number(), // commits only the upstream has, as of the last fetch
  // What VS Code marks beside the branch: changed or untracked files, staged ones, a merge or rebase under way.
  changed: z.boolean(),
  staged: z.boolean(),
  merging: z.boolean(),
});
export type Repository = z.infer<typeof repositorySchema>;

/** The repositories VS Code would list for the folder, opened as a workspace. */
export const repositoriesRpc = defineRpc({
  name: "git.repositories",
  input: z.object({ cwd: z.string() }),
  output: z.object({
    repositories: z.array(repositorySchema),
    parent: repositorySchema.nullable(), // a repository whose root lies above the folder: offered, not listed
  }),
});

export const statusRpc = defineRpc({
  name: "git.status",
  input: z.object({ cwd: z.string() }),
  output: z.object({
    branch: z.string().nullable(), // null when HEAD is detached
    head: hash.nullable(), // null before the first commit
    upstream: z.string().nullable(),
    // The branch on a remote the checked-out branch was made from, found as VS Code finds it; null when that is its upstream.
    base: z.string().nullable(),
    ahead: z.number(),
    behind: z.number(),
    conflicts: z.array(fileSchema),
    staged: z.array(fileSchema),
    changes: z.array(fileSchema), // unstaged and untracked
    refs: z.string(), // changes whenever any ref moves: the history is stale
  }),
});
export type Status = z.infer<typeof statusRpc.output>;

export const scopeSchema = z.enum(["current", "all"]); // current: the checked-out branch, its upstream and the branch it was made from
export type Scope = z.infer<typeof scopeSchema>;

export const logRpc = defineRpc({
  name: "git.log",
  input: z.object({ cwd: z.string(), scope: scopeSchema, limit: z.number().int().positive() }),
  output: z.object({
    commits: z.array(commitSchema),
    more: z.boolean(),
    // Where HEAD and its upstream stand when they differ: their commits, and the last commit they share.
    sync: z.object({ head: hash, upstream: hash, base: hash }).nullable(),
  }),
});

/** Where HEAD and its upstream stand, as the log reads it. */
export type Sync = z.infer<typeof logRpc.output>["sync"];

export const showRpc = defineRpc({
  name: "git.show",
  input: z.object({ cwd: z.string(), hash }),
  output: z.object({ message: z.string(), files: z.array(fileSchema) }),
});

/** The files that differ between two commits. */
export const compareRpc = defineRpc({
  name: "git.compare",
  input: z.object({ cwd: z.string(), from: hash, to: hash }),
  output: z.object({ files: z.array(fileSchema) }),
});

export const diffSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("commit"), hash }),
  z.object({ kind: z.literal("staged") }),
  z.object({ kind: z.literal("changes") }),
  // What a pull would bring, from the commit HEAD and its upstream share to the upstream; and what a push would send, to HEAD.
  z.object({ kind: z.literal("incoming"), from: hash, to: hash }),
  z.object({ kind: z.literal("outgoing"), from: hash, to: hash }),
]);
export type DiffSource = z.infer<typeof diffSourceSchema>;

export const diffRpc = defineRpc({
  name: "git.diff",
  input: z.object({ cwd: z.string(), source: diffSourceSchema, file: fileSchema }),
  output: z.object({ diff: z.string() }),
});

const files = z.object({ cwd: z.string(), files: z.array(fileSchema).min(1) });

export const stageRpc = defineRpc({ name: "git.stage", input: files, output: nothing });
export const unstageRpc = defineRpc({ name: "git.unstage", input: files, output: nothing });
/** Throws away unstaged edits, and deletes untracked files. */
export const discardRpc = defineRpc({ name: "git.discard", input: files, output: nothing });

export const commitRpc = defineRpc({
  name: "git.commit",
  // Amending folds what is staged into the last commit; without a message it keeps that commit's own.
  input: z
    .object({ cwd: z.string(), message: z.string(), amend: z.boolean() })
    .refine((input) => input.amend || input.message.trim() !== "", "A commit needs a message"),
  output: nothing,
});

export const syncRpc = defineRpc({
  name: "git.sync",
  input: z.object({ cwd: z.string(), action: z.enum(["fetch", "pull", "push"]) }),
  output: nothing,
});
