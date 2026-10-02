import { test } from "node:test";
import assert from "node:assert/strict";
import { planSend } from "./send.ts";

const state = (typed: Record<string, string>, outside: Record<string, number> = {}) => ({
  typed,
  attached: [],
  outside,
});

test("what is typed goes, and leaves the composer", () =>
  assert.deepEqual(planSend(state({ "c:1": " hi " }), "c:1"), { kind: "send", key: "c:1", text: "hi", take: true }));

test("a turn running outside the app keeps the typed text in the composer", () =>
  assert.deepEqual(planSend(state({ "c:1": "hi" }, { "c:1": 120 }), "c:1"), { kind: "wait-outside", key: "c:1" }));

test("forced text and Cmd-K leave the composer alone", () => {
  assert.deepEqual(planSend(state({ "c:1": "typed" }), "c:1", "forced"), {
    kind: "send",
    key: "c:1",
    text: "forced",
    take: false,
  });
  assert.deepEqual(planSend(state({ "c:1": "typed" }), "c:1", "ask", "c:2"), {
    kind: "send",
    key: "c:2",
    text: "ask",
    take: false,
  });
});

test("nothing to send, or the waiting view: nothing happens", () => {
  assert.deepEqual(planSend(state({}), "c:1"), { kind: "nothing" });
  assert.deepEqual(planSend(state({ __wait: "x" }), "__wait"), { kind: "nothing" });
});

test("typing in a terminal session forks it", () =>
  assert.deepEqual(planSend(state({ "t:s1": "go on" }), "t:s1"), { kind: "fork", text: "go on", take: true }));
