import type { AgentOption, AgentProvider } from "@vault/agent-core";
import { strings, type Key } from "./locales.ts";
import { modelName } from "./models.ts";

// Settings › Agents: the choices of src/lib.rs (PERMS), the first one the default
const options: AgentOption<Key>[] = [
  { id: "permissions", label: "opt.permissions", choices: [{ id: "ask", label: "opt.permissions.ask" }, { id: "config", label: "opt.permissions.config" }] },
];

// OpenCode in the webview: its name, glyph, strings and options. Everything that runs is in src/lib.rs and bridge.py.
const opencode: AgentProvider<Key> = {
  id: "opencode",
  name: "OpenCode",
  // an open square bracket pair: the code between
  glyph: '<path d="M5.5 3.5h-2v9h2M10.5 3.5h2v9h-2" stroke-linecap="round" stroke-linejoin="round"/>',
  strings,
  modelName,
  options,
};
export default opencode;
