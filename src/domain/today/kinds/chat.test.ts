import { test } from "node:test";
import assert from "node:assert/strict";
import { chat as kind } from "./chat.ts";
import { NOW, flags, snap, words } from "./fixtures.ts";
import type { Pending } from "../../conversations/types";
import type { EntryOf } from "./types.ts";

const chats = {
  c1: { label: "Fix login", project: "app", projectLabel: "App" },
  c2: { label: "Notes", project: null, projectLabel: "General" },
};

test("a conversation finished elsewhere is an item, unless its question is in the queue already", () => {
  const asking = { id: "p", project: "c2", tool_name: "x", input: {} } as unknown as Pending;
  const entries = kind.entries(snap({ unseen: ["c1", "c2"], chats, pending: [asking] }), words, NOW);
  assert.deepEqual(
    entries.map(e => e.id),
    ["chat:c1"],
  );
  assert.equal(entries[0].title, "Fix login");
  assert.equal(entries[0].where, "App");
  assert.equal(entries[0].project, "app");
  assert.equal(entries[0].at, NOW);
});

test("Enter reads it, Backspace marks it read", () => {
  const [draft] = kind.entries(snap({ unseen: ["c1"], chats }), words, NOW);
  const set = kind.actions(draft as EntryOf<"chat">, flags, words);
  assert.deepEqual(
    set.acts.map(a => a.id),
    ["read", "markRead"],
  );
});
