import { test } from "node:test";
import assert from "node:assert/strict";
import { ask } from "./ask.ts";
import { NOW, flags, snap, words } from "./fixtures.ts";
import type { Pending } from "../../conversations/types";
import type { EntryOf } from "./types.ts";

const request = { id: "p1", project: "c1", tool_name: "Bash", input: {} } as unknown as Pending;
const chats = { c1: { label: "Fix login", project: "app", projectLabel: "App" } };

test("a permission waits since it was first seen, in the project of its conversation", () => {
  const [draft] = ask.entries(snap({ pending: [request], pendingAt: { p1: NOW - 5 * 60_000 }, chats }), words, NOW);
  assert.equal(draft.id, "ask:p1");
  assert.equal(draft.kind, "ask");
  assert.equal(draft.at, NOW - 5 * 60_000);
  assert.equal(draft.title, 'today.allow {"tool":"Bash"}');
  assert.equal(draft.where, "Fix login");
  assert.equal(draft.why, 'today.waiting {"ago":"wait.agoMin {\\"n\\":5}"}');
  assert.equal(draft.project, "app");
  assert.equal(draft.tone, "late");
});

test("it has an Open action and nothing for Enter or Backspace: the agent's card takes them", () => {
  const [draft] = ask.entries(snap({ pending: [request], chats }), words, NOW);
  const set = ask.actions(draft as EntryOf<"ask">, flags, words);
  assert.deepEqual(
    set.acts.map(a => a.id),
    ["open"],
  );
  assert.equal(set.primary, undefined);
  assert.equal(set.secondary, undefined);
});
