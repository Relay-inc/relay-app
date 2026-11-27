import { test } from "node:test";
import assert from "node:assert/strict";
import { produce, enableMapSet } from "immer";
import { applyAgentEvent } from "./events.ts";
import { initialConversations } from "./state.ts";
import type { AgentEvent } from "../agents/types";
import { applyTasks, endTask, shownTasks, TASK_LINGER } from "./tasks.ts";

enableMapSet();
const bash = { id: "b1", kind: "local_bash", description: "Run the portal build" };
const agent = { id: "a1", kind: "local_agent", agent: "general-purpose", description: "Check the redirects" };

test("a listed task starts when first seen and keeps its start and progress", () => {
  const first = applyTasks([], [bash], 1000);
  assert.deepEqual(first, [{ ...bash, agent: undefined, since: 1000, status: "running" }]);
  const again = applyTasks([{ ...first[0], tools: 2 }], [bash, agent], 5000);
  assert.deepEqual(
    again.map(t => [t.id, t.since, t.tools]),
    [
      ["b1", 1000, 2],
      ["a1", 5000, undefined],
    ],
  );
});

test("an ended task stays a few seconds after the set drops it, then goes", () => {
  const ended = endTask(applyTasks([], [bash, agent], 0), "b1", "killed", 3000);
  assert.equal(ended[0].status, "killed");
  const dropped = applyTasks(ended, [agent], 4000);
  assert.deepEqual(
    dropped.map(t => t.id),
    ["a1", "b1"],
  );
  assert.deepEqual(
    applyTasks(dropped, [agent], 3000 + TASK_LINGER).map(t => t.id),
    ["a1"],
  );
  assert.deepEqual(
    shownTasks(dropped, 3000).map(t => t.id),
    ["b1"],
  );
  assert.deepEqual(shownTasks(dropped, 3000 + TASK_LINGER), []);
});

test("subagents stay out of the list: the agents list already shows them", () => {
  assert.deepEqual(
    shownTasks(applyTasks([], [bash, agent], 0), 0).map(t => t.id),
    ["b1"],
  );
});

test("a task that vanished without an end is dropped, and an empty set clears the list", () => {
  assert.deepEqual(applyTasks(applyTasks([], [bash], 0), [], 10).length, 0);
});

test("the events fill the list, the output and the phrase, and the end of the process clears them", () => {
  const env = { t: (k => k) as never, selected: "open", now: 5000, imageUrl: () => "" };
  const state = initialConversations({ chats: {}, hidden: [], forked: [] });
  const next = produce(state, draft => {
    for (const e of [
      { type: "tasks", tasks: [bash] },
      { type: "task_progress", id: "b1", tool_uses: 3, last_tool: "Bash" },
      { type: "task_output", id: "b1", text: "hello\n" },
      { type: "task_summary", detail: "Building the portal" },
    ] as AgentEvent[])
      applyAgentEvent(draft, "open", e, env);
  });
  assert.deepEqual(
    [next.tasks.open[0].tools, next.tasks.open[0].last, next.taskOutput.open.b1, next.taskLine.open],
    [3, "Bash", "hello\n", "Building the portal"],
  );
  const cleared = produce(next, draft => {
    applyAgentEvent(draft, "open", { type: "task_summary", detail: null }, env);
    applyAgentEvent(draft, "open", { type: "exit" }, env);
  });
  assert.deepEqual(
    [cleared.tasks.open, cleared.taskLine.open, cleared.taskOutput.open],
    [undefined, undefined, undefined],
  );
});
