import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePatch } from "../client/patch.ts";

test("a patch's lines are told apart", () => {
  const patch = [
    "diff --git a/notes.md b/notes.md",
    "index f384549..02b5054 100644",
    "--- a/notes.md",
    "+++ b/notes.md",
    "@@ -1,3 +1,3 @@",
    " one",
    "-two",
    "+TWO",
    "",
    "\\ No newline at end of file",
    "",
  ].join("\n");
  assert.deepEqual(
    parsePatch(patch).map((line) => line.kind),
    ["meta", "meta", "meta", "meta", "hunk", "plain", "remove", "add", "plain", "meta"],
  );
});

test("a removed line that looks like a header is still a removed line", () => {
  const kinds = parsePatch("diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n--- old rule\n+++ new rule\n").map((line) => line.kind);
  assert.deepEqual(kinds, ["meta", "meta", "meta", "hunk", "remove", "add"]);
});

test("each file of a patch has its own header", () => {
  const kinds = parsePatch("diff --git a/x b/x\n@@ -1 +1 @@\n+x\ndiff --git a/y b/y\nnew file mode 100644\n@@ -0,0 +1 @@\n+y\n").map((line) => line.kind);
  assert.deepEqual(kinds, ["meta", "hunk", "add", "meta", "meta", "hunk", "add"]);
});

test("no patch, no lines", () => {
  assert.deepEqual(parsePatch(""), []);
});
