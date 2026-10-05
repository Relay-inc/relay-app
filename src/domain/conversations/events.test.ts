import { test } from "node:test";
import assert from "node:assert/strict";
import { produce, enableMapSet } from "immer";
import { applyAgentEvent, contextOf, toItems, type EventEnv } from "./events.ts";
import { initialConversations, type ConversationsState } from "./state.ts";

enableMapSet();
const t = ((key: string, params?: Record<string, string | number>) =>
  params ? `${key} ${JSON.stringify(params)}` : key) as EventEnv["t"];
const env: EventEnv = { t, selected: "c:open", now: 1000 };
const fresh = (): ConversationsState => ({
  ...initialConversations({ chats: {}, hidden: [], forked: [] }),
  chats: { "c:1": { key: "c:1", project: null, title: "x", at: 0 } },
});
const run = (state: ConversationsState, ...events: Parameters<typeof applyAgentEvent>[2][]) => {
  const effects: ReturnType<typeof applyAgentEvent> = [];
  const next = produce(state, draft => {
    for (const event of events) effects.push(...applyAgentEvent(draft, "c:1", event, env));
  });
  return { next, effects };
};

test("text deltas append to the answer, a whole block starts a new one", () => {
  const { next } = run(
    fresh(),
    { type: "text", text: "Hel", delta: true },
    { type: "text", text: "lo", delta: true },
    { type: "text", text: "Second", delta: false },
    { type: "text", text: "!", delta: true },
  );
  assert.deepEqual(next.messages["c:1"], [
    { kind: "ai", text: "Hello" },
    { kind: "ai", text: "Second!" },
  ]);
});

test("thinking streams into its own item, apart from the answer", () => {
  const { next } = run(
    fresh(),
    { type: "thinking", text: "Hm", delta: false },
    { type: "thinking", text: "m", delta: true },
    { type: "text", text: "Ok", delta: false },
    { type: "text", text: "!", delta: true },
  );
  assert.deepEqual(next.messages["c:1"], [
    { kind: "thinking", text: "Hmm" },
    { kind: "ai", text: "Ok!" },
  ]);
  assert.equal(next.status["c:1"], "busy");
});

test("a delta only replaces the streaming item: the items before it keep their identity", () => {
  const { next: before } = run(
    fresh(),
    { type: "text", text: "first", delta: false },
    { type: "text", text: "a", delta: false },
  );
  const { next: after } = run(before, { type: "text", text: "b", delta: true });
  assert.equal(after.messages["c:1"][0], before.messages["c:1"][0]);
  assert.notEqual(after.messages["c:1"][1], before.messages["c:1"][1]);
  assert.equal(after.chats, before.chats);
  assert.equal(after.messages["c:1"][1].text, "ab");
});

test("a tool starts running and ends ok or with an error", () => {
  const { next } = run(
    fresh(),
    { type: "tool_call", id: "t1", name: "Read", input: { file_path: "/v/A.md" } },
    { type: "tool_call", id: "t2", name: "Bash", input: { command: "ls" } },
  );
  assert.equal(next.messages["c:1"][0].state, "run");
  assert.equal(next.messages["c:1"][0].path, "/v/A.md");
  const { next: done } = run(
    next,
    { type: "tool_result", id: "t1", error: false },
    { type: "tool_result", id: "t2", error: true },
    { type: "patch", id: "t1", hunks: [{ oldStart: 3, newStart: 3, lines: ["-a", "+b"] }] },
  );
  assert.deepEqual(
    done.messages["c:1"].map(item => item.state),
    ["ok", "err"],
  );
  assert.equal(done.messages["c:1"][0].hunks?.[0].oldStart, 3);
});

test("a mail tool marks the conversation as touching mail, once", () => {
  const { next, effects } = run(fresh(), { type: "tool_call", id: "m", name: "mcp__relay-mail__read", input: {} });
  assert.equal(next.chats["c:1"].fromMail, true);
  assert.deepEqual(effects, [{ kind: "save-chats" }]);
  assert.deepEqual(run(next, { type: "tool_call", id: "n", name: "mcp__relay-mail__read", input: {} }).effects, []);
});

test("a turn that ends ok: done with its duration, idle, a banner with the last answer, unseen when not open", () => {
  const busy = produce(fresh(), draft => {
    draft.status["c:1"] = "busy";
    draft.queued["c:1"] = 1;
  });
  const { next, effects } = run(
    busy,
    { type: "text", text: "All set", delta: false },
    { type: "turn_end", ok: true, duration_ms: 3000 },
  );
  assert.equal(next.status["c:1"], "idle");
  assert.equal(next.queued["c:1"], 0);
  assert.deepEqual(next.messages["c:1"].at(-1), { kind: "done", text: 'work.doneIn {"d":"3 s"}' });
  assert.ok(next.unseen.has("c:1"));
  assert.equal(next.chats["c:1"].at, 1000);
  assert.deepEqual(effects, [
    { kind: "notify", key: "c:1", body: "All set" },
    { kind: "save-chats" },
    { kind: "snapshot" },
  ]);
});

test("a turn end with more queued keeps the conversation busy and quiet", () => {
  const busy = produce(fresh(), draft => {
    draft.status["c:1"] = "busy";
    draft.queued["c:1"] = 2;
  });
  const { next, effects } = run(busy, { type: "turn_end", ok: true });
  assert.equal(next.status["c:1"], "busy");
  assert.equal(next.messages["c:1"], undefined);
  assert.ok(!effects.some(effect => effect.kind === "notify"));
});

test("a turn that fails shows the error and says so in the banner", () => {
  const busy = produce(fresh(), draft => {
    draft.status["c:1"] = "busy";
    draft.queued["c:1"] = 1;
  });
  const { next, effects } = run(busy, { type: "turn_end", ok: false, error: "rate limited" });
  assert.deepEqual(next.messages["c:1"], [{ kind: "err", text: "rate limited" }]);
  assert.equal(next.status["c:1"], "idle");
  assert.deepEqual(effects[0], { kind: "notify", key: "c:1", body: "rate limited" });
  const { next: unknown } = run(busy, { type: "turn_end", ok: false });
  assert.deepEqual(unknown.messages["c:1"], [{ kind: "err", text: "err.unknown" }]);
});

test("the process exiting during a turn is an interruption; after it, nothing is said", () => {
  const busy = produce(fresh(), draft => {
    draft.status["c:1"] = "busy";
    draft.queued["c:1"] = 3;
  });
  const { next, effects } = run(busy, { type: "exit" });
  assert.deepEqual(next.messages["c:1"], [{ kind: "err", text: "work.interrupted" }]);
  assert.equal(next.status["c:1"], "idle");
  assert.equal(next.queued["c:1"], 0);
  assert.deepEqual(effects, [{ kind: "notify", key: "c:1", body: "work.interrupted" }]);
  const idle = run(next, { type: "exit" });
  assert.equal(idle.next.messages["c:1"].length, 1);
  assert.deepEqual(idle.effects, []);
});

test("an event the app does not show changes nothing", () => {
  const state = fresh();
  const { next, effects } = run(state, { type: "session", id: "s" });
  assert.equal(next, state);
  assert.deepEqual(effects, []);
});

test("compacting shows a line that the boundary resolves, and keeps the history", () => {
  const { next } = run(
    fresh(),
    { type: "text", text: "earlier", delta: false },
    { type: "context", used: 150_000 },
    { type: "compacting" },
  );
  assert.deepEqual(next.messages["c:1"][1], { kind: "compact", text: "compact.running", state: "run" });
  const done = run(next, { type: "compacted", trigger: "auto", pre_tokens: 170_000, post_tokens: 9_000 }).next;
  assert.deepEqual(done.messages["c:1"], [
    { kind: "ai", text: "earlier" },
    { kind: "compact", text: "compact.auto · 170k → 9k", state: "ok" },
  ]);
  assert.deepEqual(done.context["c:1"], { used: 9_000, window: 200_000 });
});

test("a compaction without a boundary fails with the turn, and one without sizes shows no numbers", () => {
  const failed = run(fresh(), { type: "compacting" }, { type: "turn_end", ok: true }).next;
  assert.equal(failed.messages["c:1"][0].state, "err");
  const bare = run(fresh(), { type: "context", used: 5 }, { type: "compacted" }).next;
  assert.deepEqual(bare.messages["c:1"], [{ kind: "compact", text: "compact.done", state: "ok" }]);
  assert.equal(bare.context["c:1"], undefined); // the size after is unknown: no number rather than a stale one
});

test("context follows the latest message, takes the window a result names, and goes with /clear", () => {
  let { next } = run(fresh(), { type: "context", used: 40_000 });
  assert.deepEqual(next.context["c:1"], { used: 40_000, window: 200_000 });
  next = run(next, { type: "context", window: 1_000_000 }, { type: "context", used: 100_000 }).next;
  assert.deepEqual(next.context["c:1"], { used: 100_000, window: 1_000_000 });
  assert.equal(run(next, { type: "reset" }).next.context["c:1"], undefined);
});

test("a transcript shows its compaction boundary and ends with the context it left", () => {
  const history: Parameters<typeof toItems>[0] = [
    { type: "context", used: 170_000 },
    { type: "compacted", trigger: "manual", pre_tokens: 170_000, post_tokens: 9_000 },
    { type: "context", used: 9_500 },
  ];
  assert.deepEqual(
    toItems(history, () => "", t),
    [{ kind: "compact", text: "compact.done · 170k → 9k", state: "ok" }],
  );
  assert.deepEqual(contextOf(history), { used: 9_500, window: 200_000 });
});
