import type { AgentProvider } from "@relay/agent-core";
import { strings, type Key } from "./locales.ts";
import { modelName } from "./models.ts";

// Pi in the webview: its name, glyph, strings and model names. Everything that runs is in src/lib.rs.
const pi: AgentProvider<Key> = {
  id: "pi",
  name: "Pi",
  // the letter pi: a bar with two legs
  glyph: '<path d="M3 5h10M6 5v7M10 5v5.5c0 1 .5 1.5 1.5 1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  strings,
  modelName,
};
export default pi;
