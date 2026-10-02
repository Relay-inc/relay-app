import { test } from "node:test";
import assert from "node:assert/strict";
import { outgoing, planSend, refusesImages } from "./send.ts";

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

// what the agent gets (Lit's quick-send.test.ts): the project line and a mail wait for the first ordinary message
const contextOf = (project: string) => (project === "Relay" ? "Personal" : undefined);
test("the project goes in front of the first message, once", () => {
  const first = outgoing({ project: "Relay" }, "hi", contextOf);
  assert.equal(first.told, "Relay");
  assert.match(first.sent, /^<relay-project>.*"Relay" \(context Personal\).*<\/relay-project>\n\nhi$/);
  assert.deepEqual(outgoing({ project: "Relay", told: "Relay" }, "hi", contextOf), {
    sent: "hi",
    told: "",
    tookMail: false,
  });
});
test("a mail to read goes in front of the message", () =>
  assert.deepEqual(outgoing({ project: null, mail: "Mail" }, "hi", contextOf), {
    sent: "Mail\n\nhi",
    told: "",
    tookMail: true,
  }));
test("slash commands keep their prefix and defer project and mail context", () =>
  assert.deepEqual(outgoing({ project: "Relay", mail: "Saved mail context" }, "/compact", contextOf), {
    sent: "/compact",
    told: "",
    tookMail: false,
  }));
test("commands without attachments", () => {
  assert.ok(refusesImages("codex", "/review now"));
  assert.ok(refusesImages("pi", "/compact"));
  assert.ok(!refusesImages("claude", "/compact"));
  assert.ok(!refusesImages("codex", "/compacted"));
});
