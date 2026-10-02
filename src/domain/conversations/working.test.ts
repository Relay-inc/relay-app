import { test } from "node:test";
import assert from "node:assert/strict";
import { produce, enableMapSet } from "immer";
import { adoptOwnedTurns, applyAgentEvent, type EventEnv } from "./events.ts";
import { initialConversations, type ConversationsState } from "./state.ts";
import type { AgentEvent } from "../agents/types";

// The working indicator after a reload and during a live turn (Lit's working.test.ts): the app's own process table
// decides, a late poll never revives a finished turn, and activity is not counted as another prompt.
enableMapSet();
const env: EventEnv = { t: (key => key) as EventEnv["t"], selected: "open", now: 1 };
const fresh = (provider: string): ConversationsState => ({
  ...initialConversations({ chats: {}, hidden: [], forked: [] }),
  chats: { open: { key: "open", provider, title: "Conversation", project: null, at: 1 } },
});
const events = (state: ConversationsState, ...list: AgentEvent[]) =>
  produce(state, draft => {
    for (const event of list) applyAgentEvent(draft, "open", event, env);
  });
const adopt = (state: ConversationsState, running: Record<string, number>) => {
  let result!: ReturnType<typeof adoptOwnedTurns>;
  const next = produce(state, draft => {
    result = adoptOwnedTurns(draft, running);
  });
  return { next, ...result };
};

for (const provider of ["claude", "codex", "opencode", "pi"]) {
  test(`${provider}: a reload restores working from active turns`, () => {
    const { next, owned, adopted } = adopt(fresh(provider), { open: 2 });
    assert.equal(next.status.open, "busy");
    assert.equal(next.queued.open, 2);
    assert.deepEqual([...owned], ["open"]);
    assert.deepEqual(adopted, ["open"]);
    const once = events(next, { type: "turn_end", ok: true });
    assert.equal(once.status.open, "busy");
    assert.equal(events(once, { type: "turn_end", ok: true }).status.open, "idle");
  });
}

test("idle persistent processes do not animate; a late poll does not revive a finished turn", () => {
  const idle = adopt(fresh("codex"), { open: 0 });
  assert.notEqual(idle.next.status.open, "busy");
  assert.deepEqual([...idle.owned], ["open"]);
  const ended = events(fresh("codex"), { type: "turn_end", ok: true });
  const late = adopt(ended, { open: 1 });
  assert.equal(late.next.status.open, "idle");
  assert.deepEqual(late.adopted, []);
});

test("a closed conversation is left alone", () => {
  const state = fresh("claude");
  state.chats.open.closed = 5;
  const { next, owned } = adopt(state, { open: 1 });
  assert.equal(next.status.open, undefined);
  assert.equal(owned.size, 0);
});

test("live starts and reasoning restore animation without counting each activity as another prompt", () => {
  const next = events(
    fresh("claude"),
    { type: "working" },
    { type: "thinking", text: "Reasoning", delta: true },
    { type: "text", text: "Result", delta: false },
  );
  assert.equal(next.status.open, "busy");
  assert.equal(next.queued.open, 1);
  assert.equal(events(next, { type: "exit" }).status.open, "idle");
});

test("commands are kept per provider", () => {
  const state = produce(fresh("claude"), draft => {
    applyAgentEvent(draft, "open", { type: "commands", commands: [{ name: "codex", description: "" }] }, env, "codex");
    applyAgentEvent(
      draft,
      "open",
      { type: "commands", commands: [{ name: "", description: "" }, { name: "live-claude" } as never] },
      env,
      "claude",
    );
  });
  assert.deepEqual(state.commands.codex, [{ name: "codex", description: "", argumentHint: undefined }]);
  assert.deepEqual(state.commands.claude, [{ name: "live-claude", description: "", argumentHint: undefined }]);
});

test("/clear empties the conversation", () => {
  const next = events(fresh("claude"), { type: "text", text: "old", delta: false }, { type: "reset" });
  assert.deepEqual(next.messages.open, []);
});
