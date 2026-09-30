import type { AgentProvider } from "@vault/agent-core";
import { strings, type Key } from "./locales.ts";
import { modelName } from "./models.ts";

// Claude Code in the webview: its name, glyph and strings. Everything that runs is in src/lib.rs.
const claude: AgentProvider<Key> = {
  id: "claude",
  name: "Claude Code",
  // Claude's spark, eight rays
  glyph: '<path d="M8 2v4.2M8 9.8V14M2 8h4.2M9.8 8H14M3.8 3.8l3 3M9.2 9.2l3 3M3.8 12.2l3-3M9.2 6.8l3-3" stroke-linecap="round"/>',
  strings,
  modelName,
};
export default claude;
