import { test } from "node:test";
import assert from "node:assert/strict";
import { rehome } from "./migrate.ts";
import type { Chat } from "./types";

const chat = (key: string, project: string | null): Chat => ({ key, project, title: key, at: 0 });

test("a moved project takes its moved conversations and drafts along, the rest stay general where they ran", () => {
  const chats = { a: chat("a", "Kestrel"), b: chat("b", "Kestrel"), d: chat("d", "Kestrel"), o: chat("o", "Other") };
  chats.b.folder = "Quotes";
  const stayed = rehome(chats, "Kestrel", "Kestrel\u001fteam", new Set(["a"]), key => key !== "d", "/side");
  assert.deepEqual(stayed, ["b"]);
  assert.equal(chats.a.project, "Kestrel\u001fteam");
  assert.equal(chats.d.project, "Kestrel\u001fteam", "a draft follows");
  assert.equal(chats.b.project, null);
  assert.equal(chats.b.vault, "/side");
  assert.equal(chats.b.folder, undefined);
  assert.equal(chats.o.project, "Other");
});
