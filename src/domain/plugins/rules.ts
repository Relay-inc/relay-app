import type { Plugin, PluginTest, ToolOutput, ToolResult } from "./types.ts";

// What the settings page does with a plugin's entry, without the app's state.

/** An id from a name that no other plugin has: "Garmin (Connect)" is "garmin-connect", then "garmin-connect-2". The same
 *  rule as the backend's `slug`. */
export function pluginId(name: string, taken: string[]) {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/, "") || "plugin";
  for (let n = 1; ; n++) {
    const id = n === 1 ? base : `${base}-${n}`;
    if (!taken.includes(id)) return id;
  }
}
/** The environment as typed, one `NAME=value` per line; a line without `=` or with an empty name is left out. */
export function parseEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const at = line.indexOf("=");
    const name = line.slice(0, at).trim();
    if (at > 0 && name) env[name] = line.slice(at + 1).trim();
  }
  return env;
}
export const formatEnv = (env: Record<string, string>) =>
  Object.entries(env)
    .map(([name, value]) => `${name}=${value}`)
    .join("\n");
/** The arguments as typed, one per line (an argument may hold spaces); empty lines are left out. */
export const parseArgs = (text: string) => text.split("\n").filter(line => line.trim());
/** The plugins that show in the sidebar: switched on and with a view. */
export const shownPlugins = (plugins: Plugin[] = []) => plugins.filter(plugin => plugin.on && plugin.views.length);
/** The entry after a test: the views it found (the sidebar entry, a tab each), which tool renders in which view, and
 *  only allowed tools the server still has. */
export function afterTest(plugin: Plugin, found: PluginTest): Plugin {
  const known = found.tools.filter(tool => tool.app).map(tool => tool.name);
  const toolViews = Object.fromEntries(found.tools.flatMap(tool => (tool.view ? [[tool.name, tool.view]] : [])));
  return { ...plugin, views: found.views, toolViews, allowed: plugin.allowed.filter(name => known.includes(name)) };
}

// ---------- inline views: a view under the agent's call to a plugin's tool

/** Claude Code's name for a server: what it makes of the name in its config (anything but letters, digits, `_` and `-` becomes `_`). */
const claudeName = (name: string) => name.replace(/[^a-zA-Z0-9_-]/g, "_");
/** The view a call to the agent's tool `name` (`mcp__<server>__<tool>`) renders in: the plugin that is switched on and
 *  runs that server, and the view its test found for the tool. Null for any other tool. */
export function viewFor(plugins: Plugin[] = [], name: string) {
  const [, server, ...rest] = name.split("__");
  if (!name.startsWith("mcp__") || !server || !rest.length) return null;
  const tool = rest.join("__");
  for (const plugin of plugins) {
    const uri = plugin.toolViews?.[tool];
    if (plugin.on && uri && claudeName(plugin.mcp ?? plugin.id) === server) return { plugin, uri };
  }
  return null;
}
/** The height an inline view may take (the host context's `maxHeight`), and what it has before it says how tall it is. */
export const INLINE_MAX_HEIGHT = 480;
export const INLINE_HEIGHT = 160;
/** The height a view asked for (`size-changed`) within what an inline view may take; null for a message without one. */
export const inlineHeight = (asked: unknown) =>
  typeof asked === "number" && asked >= 0 ? Math.min(INLINE_MAX_HEIGHT, Math.ceil(asked)) : null;
/** What to tell the view of a call's result (`ui/notifications/tool-result`), null while there is none. The transcript
 *  of Claude Code keeps no `structuredContent`, only the text, which for a tool that has one is that JSON: an object
 *  there is what the view gets. */
export function toolResult(output: ToolOutput | null | undefined, error: boolean): ToolResult | null {
  if (!output && !error) return null;
  const text = output?.text ?? "";
  let structuredContent = output?.structured;
  if (structuredContent === undefined && text.startsWith("{")) {
    try {
      structuredContent = JSON.parse(text);
    } catch {
      // not JSON: the text is all there is
    }
  }
  return {
    content: text ? [{ type: "text", text }] : [],
    ...(structuredContent !== undefined ? { structuredContent } : {}),
    ...(error ? { isError: true } : {}),
  };
}
