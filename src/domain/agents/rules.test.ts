import { test } from "node:test";
import assert from "node:assert/strict";
import { inheritedOf, knownCaps, knownTextOnly, picksOf, seeDefaults } from "./rules.ts";
import type { AgentsStatus } from "./types";

// Cmd-K sends with its destination's picks (Lit's quick-send.test.ts): picks are per provider, a stale one is the default
const status = {
  default: "codex",
  providers: ["claude", "codex"].map(id => ({
    id,
    models: [{ id: id === "claude" ? "sonnet" : "gpt-test", label: id }],
    efforts: [{ id: id === "claude" ? "high" : "low", label: id }],
  })),
} as unknown as AgentsStatus;

test("each provider has its own picks, a stale pick falls back to the CLI default", () => {
  assert.equal(picksOf(status, "codex", "model", "gpt-test").value, "gpt-test");
  assert.equal(picksOf(status, "codex", "model", "sonnet").value, "");
  assert.equal(picksOf(status, "claude", "effort", "high").key, "effort");
  assert.equal(picksOf(status, "codex", "effort", "low").key, "effort.codex");
});

test("the CLI's defaults are named once a conversation showed them", () => {
  const resolved = {
    type: "resolved",
    model: "gpt-test",
    effort: "low",
    default_model: true,
    default_effort: true,
  } as const;
  const seen = seeDefaults({}, resolved);
  assert.deepEqual(seen, { model: "gpt-test", effort: { "gpt-test": "low" } });
  const list = status.providers[1].models;
  assert.equal(inheritedOf(seen, "model", { model: "", list }), "codex");
  assert.equal(inheritedOf(seen, "effort", { model: "", list: status.providers[1].efforts }), "codex");
  assert.equal(inheritedOf({}, "model", { model: "", list }), undefined);
  // a picked model keeps what was seen for the default
  assert.deepEqual(seeDefaults(seen, { ...resolved, model: "other", default_model: false }), {
    model: "gpt-test",
    effort: { "gpt-test": "low", other: "low" },
  });
});

// before agents_status answers, a Claude chat queues mid-turn and may go to a work machine, as before caps existed
test("what is known of the built-in providers before the status arrives", () => {
  assert.deepEqual(knownCaps("claude"), { picked: true, remote: true });
  assert.deepEqual(knownCaps("codex"), { picked: false, remote: false });
  assert.equal(knownCaps("unknown"), undefined);
  assert.deepEqual(knownTextOnly("codex"), ["compact", "review"]);
  assert.deepEqual(knownTextOnly("pi"), ["compact"]);
  assert.deepEqual(knownTextOnly("claude"), []);
});
