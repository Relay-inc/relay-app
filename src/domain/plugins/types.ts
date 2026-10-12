// Plugins: MCP servers Relay starts and shows the views of (src-tauri/src/plugins.rs is the other half).
/** The view a plugin brings: a `ui://` resource of its server. */
export type PluginViewRef = { uri: string; name: string };
/** One entry of settings.json `plugins`. `secrets` are names of environment variables whose values sit in the keychain;
 *  `allowed` the tools the plugin's views may call; `views` what the last test found (shown as tabs), which is what puts
 *  the plugin in the sidebar without starting it. `toolViews` is the same test's tool to view (`ui://` uri) mapping: what
 *  a conversation shows under a call to the tool. `mcp` is the name Claude Code knows the server by (its tools are
 *  `mcp__<mcp>__<tool>` there), the plugin's id when null. Both are absent on an entry saved before they existed. */
export type Plugin = {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  secrets: string[];
  on: boolean;
  allowed: string[];
  views: PluginViewRef[];
  toolViews?: Record<string, string>;
  mcp?: string | null;
  /** For a plugin installed from GitHub: where it came from. Its folder is the backend's `plugins/<id>/`. */
  source?: PluginSource | null;
  /** Whether the server is also registered in Claude Code (kept in step when the plugin is saved, removed with it). */
  sync?: boolean;
};
/** The repo, the ref the user asked for (null: the default branch) and the commit that was installed. */
export type PluginSource = { repo: string; ref: string | null; sha: string };
/** What the confirmation card shows before anything runs: a download the backend unpacked and read (an install or an
 *  update). `command` and `args` are what will run, `install` the command run once in the plugin's folder, `claude` the
 *  name the server would have in Claude Code and `claudeExists` whether it is taken there. `changed` (an update) names
 *  what the new manifest changed in command, args, env, secrets and install. */
export type PluginCard = {
  stage: string;
  repo: string;
  owner: string;
  ref: string | null;
  sha: string;
  date: string | null;
  message: string;
  id: string;
  name: string;
  description: string | null;
  command: string;
  args: string[];
  env: Record<string, string>;
  secrets: string[];
  install: string | null;
  claude: string;
  claudeExists: boolean;
  changed: string[];
};
/** A tool as the test lists it: `view` is the `ui://` resource it renders in, `app` whether a view may call it. */
export type PluginTool = { name: string; description?: string; view: string | null; app: boolean };
/** What Test found out: the server, its tools and its views. */
export type PluginTest = {
  server: { name?: string; version?: string } | null;
  tools: PluginTool[];
  views: PluginViewRef[];
};
/** A view ready to show: where the backend serves it, and the policy it was given. */
export type PluginViewInfo = {
  url: string;
  uri: string;
  name: string;
  prefersBorder: boolean | null;
  csp: Record<"connectDomains" | "resourceDomains" | "frameDomains" | "baseUriDomains", string[]>;
};
/** A tool call's result as MCP gives it. */
export type ToolResult = { content?: unknown[]; structuredContent?: unknown; isError?: boolean };
/** What an MCP tool answered in a conversation (the agent's `tool_result` event): its text and, when the agent hands it
 *  over (Claude Code's live stream, not its transcript), `structuredContent`. */
export type ToolOutput = { text: string; structured?: unknown };
