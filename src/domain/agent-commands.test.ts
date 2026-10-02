import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function setup() {
  const requests: { provider: string; resolve: (value: unknown) => void }[] = [];
  const store = { changed: () => {}, ls: { get: (_key: string, fallback: unknown) => fallback } };
  const modules: Record<string, unknown> = {
    "@tauri-apps/api/core": {
      invoke: (_command: string, args: { provider: string }) =>
        new Promise(resolve => requests.push({ ...args, resolve })),
    },
    "@relay/agent-claude": {},
    "@relay/agent-codex": {},
    "@relay/agent-opencode": {},
    "@relay/agent-pi": {},
    "../core/store": store,
    "./ui": {},
    "./chats/state": {},
  };
  const exports = {} as typeof import("./agents.ts");
  const code = ts.transpileModule(readFileSync(new URL("./agents.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(code, { exports, require: (id: string) => modules[id], console });
  exports.agents.status = {
    default: "claude",
    providers: ["claude", "codex", "opencode", "pi"].map(id => ({ id, on: true, detect: { installed: true } })),
  } as typeof exports.agents.status;
  return { api: exports, requests };
}

test("commands are isolated by provider and notify updates without a persisted cross-vault cache", async () => {
  const { api, requests } = setup();
  const loading = api.loadCommands();
  for (const request of requests) request.resolve([{ name: request.provider, description: "" }]);
  await loading;
  for (const provider of ["claude", "codex", "opencode", "pi"])
    assert.equal(api.commands.byProvider[provider][0].name, provider);
  api.setCommands([{ name: "live-claude", description: "" }], "claude");
  assert.equal(api.commands.byProvider.codex[0].name, "codex");
});

test("a late discovery response cannot restore another vault's commands", async () => {
  const { api, requests } = setup();
  const old = api.loadCommands();
  const current = api.loadCommands();
  requests.slice(4).forEach(request => request.resolve([{ name: "current", description: "" }]));
  await current;
  requests.slice(0, 4).forEach(request => request.resolve([{ name: "stale", description: "" }]));
  await old;
  assert.equal(api.commands.byProvider.codex[0].name, "current");
});
