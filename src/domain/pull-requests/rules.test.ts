import { test } from "node:test";
import assert from "node:assert/strict";
import { reviewsOf, secondOpinionPrompt } from "./rules.ts";
import type { Chat } from "../conversations/types.ts";
import type { PrDetail } from "./types.ts";

const chat = (key: string, at: number, pr?: string, closed?: number): Chat => ({
  key,
  project: null,
  title: key,
  at,
  pr,
  closed,
});

test("a PR's reviews: its open conversations, oldest first", () => {
  const chats = Object.fromEntries(
    [chat("b", 2, "u1"), chat("a", 1, "u1"), chat("c", 3, "u2"), chat("d", 4, "u1", 5), chat("e", 5)].map(c => [
      c.key,
      c,
    ]),
  );
  assert.deepEqual(
    reviewsOf(chats, "u1").map(c => c.key),
    ["a", "b"],
  );
});

test("a second opinion quotes the first review under its agent's name", () => {
  const pr = { url: "https://github.com/acme/web/pull/7", number: 7, title: "Fix" } as PrDetail;
  const text = secondOpinionPrompt(pr, "acme/web", "Claude Code", "Line 4 is wrong.");
  assert.ok(text.includes("acme/web #7"));
  assert.ok(text.endsWith('<review agent="Claude Code">\nLine 4 is wrong.\n</review>'));
});
