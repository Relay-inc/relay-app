import { test } from "node:test";
import assert from "node:assert/strict";
import { graphRows, type GitCommit } from "./graph.ts";

const c = (hash: string, ...parents: string[]): GitCommit => ({
  hash,
  parents,
  author: "Tess",
  at: 0,
  refs: [],
  head: false,
  subject: hash,
});

test("a straight history stays in lane 0", () => {
  const rows = graphRows([c("c", "b"), c("b", "a"), c("a")]);
  assert.deepEqual(
    rows.map(r => r.lane),
    [0, 0, 0],
  );
  assert.deepEqual(rows[0].edges, [{ from: 0, to: 0, part: "out", lane: 0 }]);
  assert.deepEqual(rows[1].edges, [
    { from: 0, to: 0, part: "in", lane: 0 },
    { from: 0, to: 0, part: "out", lane: 0 },
  ]);
  // the root ends its lane
  assert.deepEqual(rows[2].edges, [{ from: 0, to: 0, part: "in", lane: 0 }]);
  assert.deepEqual(
    rows.map(r => r.width),
    [1, 1, 1],
  );
});

test("a merge opens a lane for its second parent, which joins again at the fork", () => {
  // m merges s (side) into t (main), both fork from a
  const rows = graphRows([c("m", "t", "s"), c("s", "a"), c("t", "a"), c("a")]);
  assert.deepEqual(
    rows.map(r => r.lane),
    [0, 1, 0, 0],
  );
  assert.deepEqual(rows[0].edges, [
    { from: 0, to: 0, part: "out", lane: 0 },
    { from: 0, to: 1, part: "out", lane: 1 },
  ]);
  // s's row: lane 0 runs through, s goes on down its own lane
  assert.deepEqual(rows[1].edges, [
    { from: 0, to: 0, part: "through", lane: 0 },
    { from: 1, to: 1, part: "in", lane: 1 },
    { from: 1, to: 1, part: "out", lane: 1 },
  ]);
  // a: both lanes come in, lane 1 is free after
  assert.deepEqual(rows[3].edges, [
    { from: 0, to: 0, part: "in", lane: 0 },
    { from: 1, to: 0, part: "in", lane: 1 },
  ]);
  assert.deepEqual(
    rows.map(r => r.width),
    [2, 2, 2, 2],
  );
});

test("a branch tip that no row above waits for takes a free lane", () => {
  // x is the tip of another branch (all branches), next to main's b
  const rows = graphRows([c("b", "a"), c("x", "a"), c("a")]);
  assert.deepEqual(
    rows.map(r => r.lane),
    [0, 1, 0],
  );
  assert.deepEqual(rows[1].edges, [
    { from: 0, to: 0, part: "through", lane: 0 },
    { from: 1, to: 1, part: "out", lane: 1 },
  ]);
  assert.deepEqual(rows[2].edges, [
    { from: 0, to: 0, part: "in", lane: 0 },
    { from: 1, to: 0, part: "in", lane: 1 },
  ]);
});

test("a freed lane is taken again, the graph stays narrow", () => {
  // two merges after each other: the second side branch reuses lane 1
  const rows = graphRows([c("m2", "m1", "s2"), c("s2", "m1"), c("m1", "a", "s1"), c("s1", "a"), c("a")]);
  assert.deepEqual(
    rows.map(r => r.lane),
    [0, 1, 0, 1, 0],
  );
  assert.equal(Math.max(...rows.map(r => r.width)), 2);
});

test("a parent another lane already waits for is joined, no new lane", () => {
  // y and m both have p as parent: m's second line joins y's lane
  const rows = graphRows([c("y", "p"), c("m", "q", "p"), c("q", "p"), c("p")]);
  assert.deepEqual(rows[1].edges.at(-1), { from: 1, to: 0, part: "out", lane: 0 });
  assert.equal(Math.max(...rows.map(r => r.width)), 2);
});
