import { test } from "node:test";
import assert from "node:assert/strict";
import type { Chat } from "../conversations/types";
import type { Worker } from "./types";
import {
  ORCH,
  boardOrder,
  costumeOf,
  workerName,
  ensureCoordinator,
  ensureWorkerChat,
  isOrchKey,
  isRelayTurn,
  lastTurnIs,
  relayText,
  runningCount,
} from "./rules.ts";

const worker = (key: string, extra: Partial<Worker> = {}): Worker => ({
  key,
  project: "Northwind Portal",
  title: `Worker ${key}`,
  task: "Prepare the price range",
  repo: null,
  worktree: null,
  branch: null,
  state: "running",
  at: 1000,
  ended: null,
  report: null,
  ...extra,
});

test("a new worker gets its conversation under its project", () => {
  const chats: Record<string, Chat> = {};
  assert.equal(ensureWorkerChat(chats, worker("c:orch-w-1")), true);
  assert.deepEqual(chats["c:orch-w-1"], {
    key: "c:orch-w-1",
    project: "Northwind Portal",
    title: "Worker c:orch-w-1",
    at: 1000,
    draft: false,
    provider: "claude",
    orch: true,
  });
});

test("a known worker keeps what the user changed, one adopted as a plain chat becomes the worker", () => {
  const chats: Record<string, Chat> = {
    "c:orch-w-1": { key: "c:orch-w-1", project: "Harbor CRM", title: "Renamed", at: 5, orch: true },
    "c:orch-w-2": { key: "c:orch-w-2", project: null, title: "Gesprek", at: 7, told: "x" },
  };
  assert.equal(ensureWorkerChat(chats, worker("c:orch-w-1")), false);
  assert.equal(chats["c:orch-w-1"].title, "Renamed");
  assert.equal(ensureWorkerChat(chats, worker("c:orch-w-2", { project: null, title: "Brief" })), true);
  assert.equal(chats["c:orch-w-2"].title, "Brief");
  assert.equal(chats["c:orch-w-2"].orch, true);
  assert.equal(chats["c:orch-w-2"].at, 7);
  assert.equal(chats["c:orch-w-2"].told, "x");
});

test("the coordinator is general, Claude's, never a draft and never closed", () => {
  const chats: Record<string, Chat> = {
    [ORCH]: { key: ORCH, project: "Harbor CRM", title: "Gesprek", at: 3, closed: 9 },
  };
  ensureCoordinator(chats);
  assert.deepEqual(chats[ORCH], {
    key: ORCH,
    project: null,
    title: "Orchestrator",
    at: 3,
    draft: false,
    provider: "claude",
  });
  const empty: Record<string, Chat> = {};
  ensureCoordinator(empty);
  assert.equal(empty[ORCH].at, 0);
});

test("board: newest first, running counted", () => {
  const list = [
    worker("a", { at: 1 }),
    worker("b", { at: 3, state: "done" }),
    worker("c", { at: 2, state: "blocked" }),
  ];
  assert.deepEqual(
    boardOrder(list).map(w => w.key),
    ["b", "c", "a"],
  );
  assert.equal(list[0].key, "a"); // the input stays as it was
  assert.equal(runningCount(list), 1);
  assert.equal(runningCount([]), 0);
  // a worker whose conversation was closed leaves the board
  const chats = { b: { key: "b", project: null, title: "b", at: 3, closed: 5 } } as Record<string, Chat>;
  assert.deepEqual(
    boardOrder(list, chats).map(w => w.key),
    ["c", "a"],
  );
});

test("the orchestrator's keys", () => {
  assert.equal(isOrchKey(ORCH), true);
  assert.equal(isOrchKey("c:orch-w-k1"), true);
  assert.equal(isOrchKey("c:orchard"), false);
  assert.equal(isOrchKey("c:lq3x"), false);
});

test("turns Relay wrote itself", () => {
  assert.equal(isRelayTurn("[Relay] Report from worker c:orch-w-x (Harbor CRM): done"), true);
  assert.equal(isRelayTurn("[Relay]without a space"), false);
  assert.equal(isRelayTurn("Someone says [Relay] "), false);
  assert.equal(relayText("[Relay] Task"), "Task");
  assert.equal(relayText("plain"), "plain");
});

test("a turn the transcript already holds is not added twice", () => {
  const items = [
    { kind: "me" as const, text: "[Relay] Report" },
    { kind: "ai" as const, text: "Noted" },
  ];
  assert.equal(lastTurnIs(items, "[Relay] Report"), true);
  assert.equal(lastTurnIs(items, "[Relay] Another"), false);
  assert.equal(lastTurnIs(undefined, "x"), false);
});

test("crab: the pipeline's engineer, else the model's costume, else plain", () => {
  assert.equal(costumeOf("opus", true), "pipeline");
  assert.equal(costumeOf("sonnet", false), "sonnet");
  assert.equal(costumeOf("claude-haiku-5-5", false), "haiku");
  assert.equal(costumeOf("", false), "plain");
  assert.equal(costumeOf(undefined, false), "plain");
});

test("worker name: the same for a key, spread over the names", () => {
  assert.equal(workerName("c:orch-w-a1"), workerName("c:orch-w-a1"));
  const names = new Set(Array.from({ length: 200 }, (_, i) => workerName(`c:orch-w-${i.toString(36)}`)));
  assert.ok(names.size > 30);
});
