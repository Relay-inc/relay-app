import assert from "node:assert/strict";
import { test } from "node:test";
import { adjacency, brainKey, brainName, byBrain, folderSize, folderTree, glowLevel, glowOf, topKinds, touchedKeys } from "./rules.ts";
import type { BrainNote } from "./types.ts";

const note = (brain: string, id: string): BrainNote => ({
  brain,
  id,
  kind: "memory",
  title: id,
  created: "2026-10-01",
  author: "k",
  source: "",
  body: "",
});

test("a brain is named by its last folder", () => {
  assert.equal(brainName("/Users/k/brains/team/"), "team");
  assert.equal(brainName("/"), "/");
});

test("the same id in two brains gives two keys", () => {
  assert.notEqual(brainKey(note("/a", "1")), brainKey(note("/b", "1")));
});

test("notes are grouped per brain in order of appearance", () => {
  const groups = byBrain([note("/b", "1"), note("/a", "2"), note("/b", "3")]);
  assert.deepEqual(
    groups.map(([brain, rows]) => [brain, rows.map(row => row.id)]),
    [
      ["/b", ["1", "3"]],
      ["/a", ["2"]],
    ],
  );
});

const node = (p: string, k = "", h = false) => ({ p, t: p.split("/").pop()!.replace(/\.md$/, ""), k, g: [], h });

test("the folder tree nests notes under their folders, by name", () => {
  const nodes = [node("b/Z.md"), node("A.md"), node("b/c/Y.md"), node("b/X.md")];
  const tree = folderTree(nodes);
  assert.deepEqual(tree.notes, [1]);
  assert.equal(tree.folders[0].path, "b");
  assert.deepEqual(tree.folders[0].notes, [3, 0]);
  assert.equal(tree.folders[0].folders[0].path, "b/c");
  assert.equal(folderSize(tree), 4);
});

test("adjacency goes both ways", () => {
  assert.deepEqual(adjacency({ nodes: [node("a"), node("b"), node("c")], edges: [0, 1, 1, 2] }), [[1], [0, 2], [1]]);
});

test("three kinds get a colour, hubs do not count", () => {
  const nodes = [..."mmmmddddpppii"].map((k, i) => node(`${i}`, { m: "memory", d: "decision", p: "person", i: "index" }[k]));
  nodes.push(node("h1", "index", true), node("h2", "index", true));
  assert.deepEqual(topKinds(nodes), ["decision", "memory", "person"]);
});

test("glow keeps the last touch, any write, and the conversations", () => {
  const touches = [
    { key: "c1", root: "/v", path: "A.md", at: 100, kind: "read" as const },
    { key: "c2", root: "/v", path: "A.md", at: 300, kind: "read" as const },
    { key: "c1", root: "/v", path: "A.md", at: 200, kind: "write" as const },
    { key: "c1", root: "/b", path: "A.md", at: 400, kind: "read" as const },
    { key: "c1", root: "/v", path: "Old.md", at: 10, kind: "read" as const },
  ];
  assert.deepEqual(glowOf(touches, "/v", 50).get("A.md"), { at: 300, write: true, keys: ["c2", "c1"] });
  assert.equal(glowOf(touches, "/v", 50).has("Old.md"), false);
  assert.deepEqual(glowOf(touches, "/v", 0, "c2").get("A.md"), { at: 300, write: false, keys: ["c2"] });
  assert.deepEqual(touchedKeys(touches, "/v"), ["c2", "c1"]);
  assert.equal(glowLevel(1000, 1000, 7), 1);
  assert.ok(Math.abs(glowLevel(0, 7 * 86400000, 7) - 0.3) < 1e-9);
});
