import type { Plugin, PluginTest } from "./types.ts";

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
/** The entry after a test: the views it found (the sidebar entry, a tab each), and only allowed tools the server still has. */
export function afterTest(plugin: Plugin, found: PluginTest): Plugin {
  const known = found.tools.filter(tool => tool.app).map(tool => tool.name);
  return { ...plugin, views: found.views, allowed: plugin.allowed.filter(name => known.includes(name)) };
}
