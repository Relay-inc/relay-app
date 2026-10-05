import { test } from "node:test";
import assert from "node:assert/strict";
import { grew, relatedQuery } from "./rules.ts";
import type { Item } from "../conversations/types";

const item = (kind: Item["kind"], text: string): Item => ({ kind, text });

test("the query is the last eight user and agent messages, tool output skipped", () => {
  const items = [item("tool", "ls"), ...Array.from({ length: 9 }, (_, i) => item(i % 2 ? "ai" : "me", `m${i}`))];
  assert.equal(relatedQuery(items), "m1\nm2\nm3\nm4\nm5\nm6\nm7\nm8");
});

test("the query is capped, keeping the end", () => {
  const query = relatedQuery([item("me", "a".repeat(7000) + "z")]);
  assert.equal(query.length, 6000);
  assert.ok(query.endsWith("z"));
});

test("the index is asked again only when the conversation grew", () => {
  assert.equal(grew(0, undefined), false);
  assert.equal(grew(3, undefined), true);
  assert.equal(grew(3, 3), false);
  assert.equal(grew(4, 3), true);
});
