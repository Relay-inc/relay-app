import { test } from "node:test";
import assert from "node:assert/strict";
import { decisionOf } from "./rules.ts";
import type { Pending } from "./types.ts";

const suggestions = [
  {
    type: "addRules",
    rules: [{ toolName: "Bash", ruleContent: "touch x" }],
    behavior: "allow",
    destination: "localSettings",
  },
];
const bash: Pending = {
  id: "a1",
  project: "c:1",
  kind: "tool",
  tool_name: "Bash",
  input: { command: "touch x" },
  suggestions,
};

test("allow once leaves the permissions alone, always allow hands the agent's suggestions back", () => {
  assert.deepEqual(decisionOf(bash, "allow"), { behavior: "allow", updatedInput: bash.input });
  assert.deepEqual(decisionOf(bash, "always"), {
    behavior: "allow",
    updatedInput: bash.input,
    updatedPermissions: suggestions,
  });
});

test("deny and a question's answers", () => {
  assert.equal(decisionOf(bash, "deny")?.behavior, "deny");
  const ask: Pending = {
    id: "b2",
    project: "c:1",
    kind: "question",
    tool_name: "AskUserQuestion",
    input: { questions: [{ question: "Colors?", multiSelect: true, options: [{ label: "Red" }, { label: "Blue" }] }] },
  };
  assert.equal(decisionOf(ask, { picked: [[]], other: [""] }), null);
  assert.deepEqual(decisionOf(ask, { picked: [["Red", "Blue"]], other: ["mauve"] }), {
    behavior: "allow",
    updatedInput: { ...ask.input, answers: { "Colors?": "Red, Blue, mauve" } },
  });
});
