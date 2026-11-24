import type { AgentOption, AgentProvider } from "@relay/agent-core";
import { strings, type Key } from "./locales.ts";
import { modelName } from "./models.ts";

// Settings › Agents: the modes of src/lib.rs (`command`), the first one the default
const options: AgentOption<Key>[] = [
  { id: "mode", label: "opt.mode", choices: [
    { id: "auto", label: "opt.mode.auto" }, { id: "accept-edits", label: "opt.mode.accept-edits" }, { id: "default", label: "opt.mode.default" }] },
];

// Antigravity in the webview: its name, glyph, strings and options. Everything that runs is in src/lib.rs and src/bridge.rs.
const antigravity: AgentProvider<Key> = {
  id: "antigravity",
  name: "Antigravity",
  // an arch: two legs that meet in a rounded top
  glyph: '<path d="M2.5 13.5C5.2 11.2 5.3 2.5 8 2.5s2.8 8.7 5.5 11" stroke-linecap="round" stroke-linejoin="round"/>',
  strings,
  modelName,
  options,
};
export default antigravity;
