import { test } from "node:test";
import assert from "node:assert/strict";
import { arranged, isHidden, place } from "./sidebar-order.ts";

const items = ["a", "b", "c", "d"].map(key => ({ key, name: key }));
const keys = (list: { key: string }[]) => list.map(item => item.key);

test("dragged views come first in their order, new ones after in their own", () => {
  assert.deepEqual(keys(arranged(items, { order: ["c", "a"] })), ["c", "a", "b", "d"]);
  assert.deepEqual(keys(arranged(items)), ["a", "b", "c", "d"]);
});

test("a drop moves the view before or after another, a hidden one keeps its place", () => {
  const order = place(keys(items), "d", "b", false);
  assert.deepEqual(order, ["a", "d", "b", "c"]);
  assert.deepEqual(place(order, "a", "c", true), ["d", "b", "c", "a"]);
  assert.ok(isHidden("b", { hidden: ["b"] }));
  assert.ok(!isHidden("b", {}));
});
