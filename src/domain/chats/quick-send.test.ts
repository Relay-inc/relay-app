import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { Chat, Item } from "./state.ts";

// Run the real domain modules with window/IPC boundaries replaced. This catches the send's
// destination selection as well as picks(), without booting Lit or a native agent process.
function load<T>(file: string, modules: Record<string, unknown>): T {
  const exports = {};
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  runInNewContext(outputText, {
    exports,
    require: (id: string) => {
      assert.ok(id in modules, `Unexpected dependency: ${id}`);
      return modules[id];
    },
  });
  return exports as T;
}

function setup(defaultProvider = "codex") {
  const noop = () => {};
  const ui = { selected: "open" };
  const chat = {
    chats: { open: { key: "open", provider: "claude", title: "Existing", project: null, at: 1 } } as Record<
      string,
      Chat
    >,
    typed: { open: "Keep my draft" },
    attached: [],
    messages: { open: [] } as Record<string, Item[]>,
    status: {},
    queued: {},
    outside: {},
  };
  const saved: Record<string, string> = {
    model: "sonnet",
    effort: "high",
    "model.codex": "gpt-test",
    "effort.codex": "low",
  };
  const store = {
    changed: noop,
    request: noop,
    ls: { get: (key: string, fallback: unknown) => saved[key] ?? fallback, set: noop },
  };
  const sends: Record<string, unknown>[] = [];
  const ipc = {
    invoke: async (command: string, args: Record<string, unknown>) => {
      if (command === "send") sends.push(args);
      return "Generated title";
    },
  };
  const agents = load<typeof import("../agents.ts")>("../agents.ts", {
    "@tauri-apps/api/core": ipc,
    "@relay/agent-claude": {},
    "@relay/agent-codex": {},
    "@relay/agent-opencode": {},
    "@relay/agent-pi": {},
    "../core/store": store,
    "./ui": { ui, isTerminal: () => false },
    "./chats/state": { chat },
  });
  agents.agents.status = {
    default: defaultProvider,
    providers: ["claude", "codex"].map(id => ({
      id,
      models: [{ id: id === "claude" ? "sonnet" : "gpt-test", label: id }],
      efforts: [{ id: id === "claude" ? "high" : "low", label: id }],
    })) as typeof agents.agents.status.providers,
  };
  const actions = load<typeof import("./actions.ts")>("./actions.ts", {
    "@tauri-apps/api/core": ipc,
    "../../core/i18n": { t: (key: string) => key },
    "../../core/store": store,
    "../ui": { ui, WAIT: "wait", isTerminal: () => false },
    "../config": {},
    "../icons": {},
    "../vault": { findProjects: () => [], project: () => undefined },
    "../agents": agents,
    "../navigation": { toast: noop },
    "./state": {
      chat,
      NEW: "New",
      saveChats: noop,
      displayTitle: (s: string) => s,
      newChat: (project: string | null) => {
        chat.chats.new = { key: "new", title: "New", project, at: 2, draft: true };
        return "new";
      },
    },
    "./events": { push: (key: string, item: Item) => (chat.messages[key] ||= []).push(item) },
    "../keys": {},
  });
  return { actions, agents, chat, ui, saved, sends };
}

test("Cmd-K uses its destination's provider, model and effort while leaving the open draft alone", () => {
  const { actions, chat, ui, sends } = setup();
  actions.quickSend("A quick question", []);
  assert.equal(sends.length, 1);
  assert.equal(sends[0].project, "new");
  assert.equal(sends[0].provider, "codex");
  assert.equal(sends[0].model, "gpt-test");
  assert.equal(sends[0].effort, "low");
  assert.equal(ui.selected, "open");
  assert.equal(chat.typed.open, "Keep my draft");
});

test("a stale destination pick falls back to the CLI default, not the open conversation's pick", () => {
  const { actions, saved, sends } = setup();
  saved["model.codex"] = "removed-model";
  saved["effort.codex"] = "removed-effort";
  actions.quickSend("A quick question", []);
  assert.equal(sends[0].provider, "codex");
  assert.equal(sends[0].model, "");
  assert.equal(sends[0].effort, "");
});

test("sending in the composer still uses the open conversation's picks", async () => {
  const { actions, agents, sends } = setup();
  assert.equal(agents.picks("model").value, "sonnet");
  await actions.sendMsg();
  assert.equal(sends[0].project, "open");
  assert.equal(sends[0].provider, "claude");
  assert.equal(sends[0].model, "sonnet");
  assert.equal(sends[0].effort, "high");
});

test("Cmd-K also uses the default Claude picks while Codex is open", () => {
  const { actions, chat, sends } = setup("claude");
  chat.chats.open.provider = "codex";
  actions.quickSend("A quick question", []);
  assert.equal(sends[0].provider, "claude");
  assert.equal(sends[0].model, "sonnet");
  assert.equal(sends[0].effort, "high");
});

test("slash commands keep their prefix and defer project/mail context", async () => {
  const { actions, chat, sends } = setup();
  chat.chats.open.project = "Relay";
  chat.chats.open.mail = "Saved mail context";
  await actions.sendMsg("/compact");
  assert.equal(sends[0].text, "/compact");
  assert.equal(chat.chats.open.told, undefined);
  assert.equal(chat.chats.open.mail, "Saved mail context");
});
