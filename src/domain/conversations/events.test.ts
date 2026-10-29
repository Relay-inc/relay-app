import { test } from "node:test";
import assert from "node:assert/strict";
import { produce, enableMapSet } from "immer";
import { applyAgentEvent, contextOf, toItems, type EventEnv } from "./events.ts";
import { initialConversations, type ConversationsState } from "./state.ts";

enableMapSet();
const t = ((key: string, params?: Record<string, string | number>) =>
  params ? `${key} ${JSON.stringify(params)}` : key) as EventEnv["t"];
const env: EventEnv = { t, selected: "c:open", now: 1000, imageUrl: (mt, data) => `${mt};${data}` };
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
    { type: "tool_images", id: "t1", images: [{ media_type: "image/png", data: "AA==" }] },
    { type: "tool_output", id: "t2", text: "boom" },
  );
  assert.deepEqual(
    done.messages["c:1"].map(item => item.state),
    ["ok", "err"],
  );
  assert.equal(done.messages["c:1"][0].hunks?.[0].oldStart, 3);
  assert.deepEqual(done.messages["c:1"][0].imgs, ["image/png;AA=="]);
  assert.equal(done.messages["c:1"][1].output, "boom");
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
  assert.deepEqual(next.messages["c:1"].at(-1), {
    kind: "done",
    text: 'work.doneIn {"d":"3 s"}',
    at: 1000,
    receipt: { edits: 0, errors: 0, agents: 0 },
  });
  assert.ok(next.unseen.has("c:1"));
  assert.equal(next.chats["c:1"].at, 1000);
  assert.deepEqual(effects, [
    { kind: "notify", key: "c:1", body: "All set" },
    { kind: "save-chats" },
    { kind: "snapshot" },
  ]);
});

test("the end of a turn counts what that turn did since the last end, and what it cost", () => {
  const call = (id: string, name: string) => ({ type: "tool_call" as const, id, name, input: {} });
  const { next } = run(
    fresh(),
    call("e0", "Edit"),
    { type: "turn_end", ok: true },
    call("e1", "Edit"),
    call("w1", "Write"),
    { type: "tool_result", id: "w1", error: true },
    call("a1", "Agent"),
    call("r1", "Read"),
    { type: "turn_end", ok: true, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 0.04 } },
  );
  assert.deepEqual(next.messages["c:1"].at(-1)?.receipt, { edits: 1, errors: 1, agents: 1, cost: 0.04 });
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

test("a reported window stays with the conversation, and a transcript counts against it", () => {
  const { next, effects } = run(fresh(), { type: "context", window: 1_000_000 });
  assert.equal(next.chats["c:1"].window, 1_000_000);
  assert.deepEqual(effects, [{ kind: "save-chats" }]);
  assert.deepEqual(run(next, { type: "context", window: 1_000_000 }).effects, []); // the same window saves nothing
  const history: Parameters<typeof toItems>[0] = [{ type: "context", used: 150_000 }];
  assert.deepEqual(contextOf(history, 1_000_000), { used: 150_000, window: 1_000_000 });
  // no window known: more than 200k can only be a 1M model's
  assert.deepEqual(contextOf(history), { used: 150_000, window: 200_000 });
  assert.deepEqual(contextOf([{ type: "context", used: 300_000 }]), { used: 300_000, window: 1_000_000 });
});

test("a transcript's message carries the time of its line, one without a time line has none", () => {
  const history: Parameters<typeof toItems>[0] = [
    { type: "user", text: "first", images: [] },
    { type: "time", at: "2026-10-14T12:30:00.000Z" },
    { type: "user", text: "second", images: [] },
  ];
  assert.deepEqual(
    toItems(history, () => "", t).map(item => item.at),
    [undefined, Date.parse("2026-10-14T12:30:00.000Z")],
  );
});

test("a transcript's tool step shows the images its result held", () => {
  const items = toItems(
    [
      { type: "tool_call", id: "t1", name: "Read", input: { file_path: "/v/shot.png" } },
      { type: "tool_images", id: "t1", images: [{ media_type: "image/png", data: "AA==" }] },
      { type: "tool_call", id: "t2", name: "Bash", input: { command: "ls" } },
      { type: "tool_output", id: "t2", text: "a.md" },
    ],
    (mt, data) => `${mt};${data}`,
    t,
  );
  assert.deepEqual(items[0].imgs, ["image/png;AA=="]);
  assert.equal(items[1].output, "a.md");
});

// two messages sent to Claude Code, neither read yet
const sentTwo = () =>
  produce(fresh(), draft => {
    draft.status["c:1"] = "busy";
    draft.queued["c:1"] = 2;
    draft.waiting["c:1"] = [
      { kind: "me", text: "one" },
      { kind: "me", text: "two" },
    ];
  });

test("a message sent during a turn joins it where Claude reads it, and one turn end answers both", () => {
  const { next } = run(
    sentTwo(),
    { type: "picked", text: "one (with context)" },
    { type: "text", text: "ok", delta: false },
    { type: "picked", text: "two" },
    { type: "text", text: "hi", delta: false },
    { type: "turn_end", ok: true },
  );
  assert.deepEqual(
    next.messages["c:1"].map(item => item.text),
    ["one", "ok", "two", "hi", "work.done"],
  );
  assert.equal(next.status["c:1"], "idle");
  assert.equal(next.queued["c:1"], 0);
  assert.equal(next.waiting["c:1"].length, 0);
});

test("a message Claude keeps for its own turn waits through the first turn's end", () => {
  const first = run(
    sentTwo(),
    { type: "picked", text: "one" },
    { type: "text", text: "ok", delta: false },
    {
      type: "turn_end",
      ok: true,
    },
  ).next;
  assert.equal(first.status["c:1"], "busy");
  assert.deepEqual(first.waiting["c:1"], [{ kind: "me", text: "two" }]);
  const { next } = run(first, { type: "picked", text: "two" }, { type: "turn_end", ok: true });
  assert.equal(next.status["c:1"], "idle");
  assert.deepEqual(
    next.messages["c:1"].map(item => item.text),
    ["one", "ok", "two", "work.done"],
  );
});

test("a turn that echoes nothing (a slash command) takes up the oldest waiting message", () => {
  const sent = produce(fresh(), draft => {
    draft.queued["c:1"] = 1;
    draft.waiting["c:1"] = [{ kind: "me", text: "/cost" }];
  });
  const answered = run(sent, { type: "text", text: "$0.12", delta: false }, { type: "turn_end", ok: true }).next;
  assert.deepEqual(
    answered.messages["c:1"].map(item => item.text),
    ["/cost", "$0.12", "work.done"],
  );
  const cleared = run(sent, { type: "turn_end", ok: true }).next;
  assert.deepEqual(cleared.messages["c:1"][0], { kind: "me", text: "/cost" });
  assert.equal(cleared.status["c:1"], "idle");
});

test("Relay's own turn is answered without taking up the user's waiting message", () => {
  const sent = produce(fresh(), draft => {
    draft.queued["c:1"] = 2;
    draft.waiting["c:1"] = [{ kind: "me", text: "mine" }];
  });
  const { next } = run(
    sent,
    { type: "picked", text: "[Relay] Report" },
    { type: "text", text: "noted", delta: false },
    {
      type: "turn_end",
      ok: true,
    },
  );
  assert.deepEqual(next.waiting["c:1"], [{ kind: "me", text: "mine" }]);
  assert.equal(next.status["c:1"], "busy");
});

test("waiting messages show in the conversation when the process exits", () => {
  const { next } = run(sentTwo(), { type: "exit" });
  assert.deepEqual(
    next.messages["c:1"].map(item => item.text),
    ["one", "two", "work.interrupted"],
  );
  assert.equal(next.waiting["c:1"], undefined);
});

test("a message sent while a turn Claude started itself runs waits for its echo", () => {
  const working = run(fresh(), { type: "text", text: "The task finished", delta: false }).next;
  const sent = produce(working, draft => {
    draft.queued["c:1"] = 2;
    draft.waiting["c:1"] = [{ kind: "me", text: "and now?" }];
  });
  const more = run(sent, { type: "text", text: ", all good", delta: true }).next;
  assert.deepEqual(more.waiting["c:1"], [{ kind: "me", text: "and now?" }]);
  const { next } = run(more, { type: "picked", text: "and now?" }, { type: "turn_end", ok: true });
  assert.equal(next.status["c:1"], "idle");
  assert.equal(next.messages["c:1"][1].text, "and now?");
});
