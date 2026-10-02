import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { Mail, MailFilter } from "./mail.ts";

// mail.ts with its window/IPC neighbours stubbed, the way quick-send.test.ts loads its modules
const source = readFileSync(new URL("./mail.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const exports = {} as typeof import("./mail.ts");
const noop = () => {};
const stubs: Record<string, unknown> = {
  "@tauri-apps/api/core": { invoke: noop },
  "../core/i18n": { t: (k: string) => k },
  "../core/store": { changed: noop, ls: { get: (_: string, fallback: unknown) => fallback, set: noop } },
  "../core/markdown": { urlOk: () => true },
  "./config": { config: { value: { mail: { accounts: [] } } }, mailOn: () => true, mailExperimental: () => true },
  "./vault": { findProjects: () => [] },
  "./chats/state": {},
  "./panel": { panel: { detail: {}, mailOpen: "" }, openMail: noop },
  "./keys": { mailKey: (m: Mail) => `mail:${m.account}:${m.id}`, isMailKey: () => true },
  "./navigation": {},
  "./chats/actions": {},
};
runInNewContext(outputText, {
  exports,
  require: (id: string) => stubs[id] ?? assert.fail(`Unexpected dependency: ${id}`),
});
const { filtered, mail, toggleMailSelect } = exports;

const row = (id: string, other = false): Mail => ({
  id,
  account: "a@b.be",
  subject: id,
  date: "2026-10-02T10:00:00Z",
  unread: false,
  from: [{ name: null, email: "x@y.be" }],
  to: [],
  attachments: false,
  other,
});
const filter: MailFilter = { q: "", state: "all", project: "", box: "inbox" };

test("the split puts Other mails in their own box, without it everything is the inbox", () => {
  const list = [row("1"), row("2", true)];
  assert.deepEqual(
    filtered(list, filter, true).map(m => m.id),
    ["1"],
  );
  assert.deepEqual(
    filtered(list, { ...filter, box: "other" }, true).map(m => m.id),
    ["2"],
  );
  assert.deepEqual(
    filtered(list, { ...filter, box: "other" }).map(m => m.id),
    ["1", "2"],
  );
});

test("a click ticks one, shift-click ticks the range from the last one", () => {
  const shown = ["k1", "k2", "k3", "k4"];
  toggleMailSelect("k1", false, shown);
  toggleMailSelect("k3", true, shown);
  assert.deepEqual([...mail.selected].sort(), ["k1", "k2", "k3"]);
  toggleMailSelect("k2", false, shown);
  assert.deepEqual([...mail.selected].sort(), ["k1", "k3"]);
});
