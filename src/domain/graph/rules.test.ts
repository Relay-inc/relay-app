import assert from "node:assert/strict";
import { test } from "node:test";
import { adjacency, glowLevel, glowOf, topKinds, touchedKeys } from "./rules.ts";

const node = (p: string, k = "", h = false) => ({ p, t: p.split("/").pop()!.replace(/\.md$/, ""), k, g: [], h });

test("adjacency goes both ways", () => {
  assert.deepEqual(adjacency({ nodes: [node("a"), node("b"), node("c")], edges: [0, 1, 1, 2] }), [[1], [0, 2], [1]]);
});

test("six kinds get a colour, hubs do not count", () => {
  const nodes = [..."aaaaabbbbccccdddeeffgi"].map((k, i) => node(`${i}`, `kind-${k}`));
  nodes.push(node("h1", "kind-i", true), node("h2", "kind-i", true), node("h3", "kind-i", true));
  assert.deepEqual(topKinds(nodes), ["kind-a", "kind-b", "kind-c", "kind-d", "kind-e", "kind-f"]);
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
