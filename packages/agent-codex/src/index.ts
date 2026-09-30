import type { AgentOption, AgentProvider } from "@vault/agent-core";
import { strings, type Key } from "./locales.ts";
import { modelName } from "./models.ts";

// Settings › Agents: the choices of src/lib.rs (SANDBOX, APPROVAL, AUTH), the first one the default
const options: AgentOption<Key>[] = [
  { id: "sandbox", label: "opt.sandbox", choices: [
    { id: "workspace-write", label: "opt.sandbox.workspace-write" }, { id: "read-only", label: "opt.sandbox.read-only" },
    { id: "danger-full-access", label: "opt.sandbox.danger-full-access" }] },
  { id: "approval", label: "opt.approval", choices: [
    { id: "on-request", label: "opt.approval.on-request" }, { id: "untrusted", label: "opt.approval.untrusted" }, { id: "never", label: "opt.approval.never" }] },
  { id: "auth", label: "opt.auth", choices: [{ id: "chatgpt", label: "opt.auth.chatgpt" }, { id: "api-key", label: "opt.auth.api-key" }] },
];

// Codex in the webview: its name, glyph, strings and options. Everything that runs is in src/lib.rs and bridge.py.
const codex: AgentProvider<Key> = {
  id: "codex",
  name: "Codex",
  // a prompt: chevron and cursor
  glyph: '<path d="M3.5 4.5 7 8l-3.5 3.5M8.5 11.5h4" stroke-linecap="round" stroke-linejoin="round"/>',
  strings,
  modelName,
  options,
};
export default codex;
