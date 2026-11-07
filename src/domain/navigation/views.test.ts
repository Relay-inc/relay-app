import { test } from "node:test";
import assert from "node:assert/strict";
import { backAfter, type Back } from "./views.ts";
import { pageKey } from "./keys.ts";

const from = (key: string): Back => ({ key, tool: null, drawer: "terminal", top: 120 });

test("backAfter: a page goes back to the conversation it was opened from, one level", () => {
  const chat = from("c:northwind");
  const first = backAfter(null, chat, pageKey("Projects/Portal.md"));
  assert.deepEqual(first, chat, "a page from a conversation: back to it, its drawer and scroll kept");
  assert.equal(
    backAfter(first, from(pageKey("Projects/Portal.md")), pageKey("People/Sofie Claes.md")),
    first,
    "a page from a page keeps the first one's Back",
  );
  assert.equal(backAfter(first, from(pageKey("Projects/Portal.md")), "c:other"), null, "leaving the pages drops it");
  assert.equal(backAfter(null, from(pageKey("A.md")), pageKey("B.md")), null, "a page from a page without one");
  assert.equal(backAfter(first, from(pageKey("A.md")), pageKey("A.md")), first, "the same page again");
  assert.deepEqual(backAfter(null, from("__wait"), pageKey("A.md"))?.key, "__wait", "from a view too");
});
