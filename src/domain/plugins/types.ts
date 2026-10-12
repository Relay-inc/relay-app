// Plugins: MCP servers Relay starts and shows the views of (src-tauri/src/plugins.rs is the other half).
/** The view a plugin brings: a `ui://` resource of its server. */
export type PluginViewRef = { uri: string; name: string };
/** One entry of settings.json `plugins`. `secrets` are names of environment variables whose values sit in the keychain;
 *  `allowed` the tools the plugin's view may call; `view` what the last test found, which is what puts the plugin in the
 *  sidebar without starting it. */
export type Plugin = {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  secrets: string[];
  on: boolean;
  allowed: string[];
  view: PluginViewRef | null;
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
