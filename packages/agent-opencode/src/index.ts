import type { AgentOption, AgentProvider } from "@relay/agent-core";
import { strings, type Key } from "./locales.ts";
import { modelName } from "./models.ts";

// Settings › Agents: the choices of src/lib.rs (PERMS), the first one the default
const options: AgentOption<Key>[] = [
  { id: "permissions", label: "opt.permissions", choices: [{ id: "ask", label: "opt.permissions.ask" }, { id: "config", label: "opt.permissions.config" }] },
];

// OpenCode in the webview: its name, glyph, strings and options. Everything that runs is in src/lib.rs and src/bridge.rs.
const opencode: AgentProvider<Key> = {
  id: "opencode",
  name: "OpenCode",
  // OpenCode's mark (Simple Icons, 24×24), in one colour: the text's
  glyph: '<g transform="scale(.6667)" fill="currentColor" stroke="none"><path d="M22 24H2V0h20zM17 4.8H7v14.4h10z"/></g>',
  strings,
  modelName,
  options,
};
export default opencode;
