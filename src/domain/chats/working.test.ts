import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { chat as chatState } from "./state.ts";
type ChatState = typeof chatState;

function setup() {
  const chat = {
    chats: {},
    status: {},
    queued: {},
    messages: {},
    sidOf: {},
    agentsList: [],
    outside: {},
    outsideAt: {},
    unseen: new Set(),
    termOffset: {},
  } as unknown as ChatState;
  let running: Record<string, number> | Promise<Record<string, number>> = {};
  const modules: Record<string, unknown> = {
    "@tauri-apps/api/core": { invoke: async (command: string) => (command === "running" ? running : []) },
    "@tauri-apps/api/window": { getCurrentWindow: () => ({ isFocused: async () => true }) },
    "../../core/i18n": { t: (key: string) => key },
    "../../core/store": { changed: () => {} },
    "../agents": { setCommands: () => {} },
    "../ui": { ui: { selected: "open" }, isTerminal: () => false },
    "../vault": { loadSnapshot: () => {} },
    "../keys": {},
    "./state": { chat, saveChats: () => {}, lastAi: () => "", label: () => "", formatDuration: () => "" },
  };
  const exports = {} as typeof import("./events.ts");
  const code = ts.transpileModule(readFileSync(new URL("./events.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(code, { exports, require: (id: string) => modules[id] });
  return {
    chat,
    events: exports,
    setRunning: (value: typeof running) => {
      running = value;
    },
  };
}

for (const provider of ["claude", "codex", "opencode", "pi"]) {
  test(`${provider}: a reload restores working from active turns, despite an idle CLI session catalog`, async () => {
    const { chat, events, setRunning } = setup();
    chat.chats.open = { key: "open", provider, title: "Conversation", project: null, at: 1 };
    chat.sidOf.open = { provider, sid: "s" };
    chat.agentsList = [{ provider, sessionId: "s", status: "idle" }] as typeof chat.agentsList;
    setRunning({ open: 2 });
    await events.syncBusy();
    assert.equal(chat.status.open, "busy");
    assert.equal(chat.queued.open, 2);
    events.onEvent("open", { type: "turn_end", ok: true });
    assert.equal(chat.status.open, "busy");
    events.onEvent("open", { type: "turn_end", ok: true });
    assert.equal(chat.status.open, "idle");
  });
}

test("idle persistent processes do not animate; a late poll does not revive a finished turn", async () => {
  const { chat, events, setRunning } = setup();
  chat.chats.open = { key: "open", provider: "codex", title: "Conversation", project: null, at: 1 };
  setRunning({ open: 0 });
  await events.syncBusy();
  assert.notEqual(chat.status.open, "busy");
  let resolve!: (value: Record<string, number>) => void;
  setRunning(
    new Promise(done => {
      resolve = done;
    }),
  );
  const polling = events.syncBusy();
  events.onEvent("open", { type: "turn_end", ok: true });
  resolve({ open: 1 });
  await polling;
  assert.equal(chat.status.open, "idle");
});

test("live starts and reasoning restore animation without counting each activity as another prompt", () => {
  const { chat, events } = setup();
  events.onEvent("open", { type: "working" });
  events.onEvent("open", { type: "thinking", text: "Reasoning", delta: true });
  events.onEvent("open", { type: "text", text: "Result", delta: false });
  assert.equal(chat.status.open, "busy");
  assert.equal(chat.queued.open, 1);
  events.onEvent("open", { type: "exit" });
  assert.equal(chat.status.open, "idle");
});
