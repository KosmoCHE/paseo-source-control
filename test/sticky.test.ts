import assert from "node:assert/strict";
import { test } from "node:test";
import { held } from "../client/sticky.ts";

const H = 10;
// group (0) > folder (1) > two files (2); a second group (0) with one file (1).
const rows = [
  { depth: 0, inside: 3 },
  { depth: 1, inside: 2 },
  { depth: 2, inside: 0 },
  { depth: 2, inside: 0 },
  { depth: 0, inside: 1 },
  { depth: 1, inside: 0 },
];

test("nothing is kept before the list has scrolled", () => {
  assert.deepEqual(held(rows, 0, H), []);
  assert.deepEqual(held(rows, -25, H), []); // rows still below something above them, such as the commit box
});

test("a group stays at the top, and a folder in it under it", () => {
  // The folder's own row is half under the group's: it stays a row down.
  assert.deepEqual(held(rows, 5, H), [
    { index: 0, top: 0 },
    { index: 1, top: 10 },
  ]);
  assert.deepEqual(held(rows, 15, H), [
    { index: 0, top: 0 },
    { index: 1, top: 10 },
  ]);
});

test("the next group pushes the last one out, and its folder goes under it first", () => {
  // The second group's row is 15 below the top: the folder slides up under the first group's row.
  assert.deepEqual(held(rows, 25, H), [
    { index: 0, top: 0 },
    { index: 1, top: 5 },
  ]);
  // Now 5 below: the first group's row is pushed half out, its folder is hidden behind it.
  assert.deepEqual(held(rows, 35, H), [{ index: 0, top: -5 }]);
  // The second group has taken the top.
  assert.deepEqual(held(rows, 45, H), [{ index: 4, top: 0 }]);
});

test("the next folder takes the place of the last one at its depth", () => {
  const tree = [
    { depth: 0, inside: 5 },
    { depth: 1, inside: 2 }, // a
    { depth: 2, inside: 1 }, // a/b
    { depth: 3, inside: 0 },
    { depth: 1, inside: 1 }, // c
    { depth: 2, inside: 0 },
  ];
  assert.deepEqual(held(tree, 10, H), [
    { index: 0, top: 0 },
    { index: 1, top: 10 },
    { index: 2, top: 20 },
  ]);
  // c's row is 15 below the top: a is pushed up under the group, a/b has gone.
  assert.deepEqual(held(tree, 25, H), [
    { index: 0, top: 0 },
    { index: 1, top: 5 },
  ]);
  assert.deepEqual(held(tree, 35, H), [
    { index: 0, top: 0 },
    { index: 4, top: 10 },
  ]);
});

test("a folded row holds nothing and is never kept", () => {
  assert.deepEqual(
    held(
      [
        { depth: 0, inside: 0 },
        { depth: 0, inside: 0 },
      ],
      15,
      H,
    ),
    [],
  );
});
