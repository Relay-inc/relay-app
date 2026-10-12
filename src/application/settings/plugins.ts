import { t } from "../../shared/i18n";
import { afterTest } from "../../domain/plugins/rules";
import type { Plugin } from "../../domain/plugins/types";
import type { Message } from "../../domain/settings/types";
import * as backend from "../../infrastructure/backend";
import { commit } from "./window";
import { useSettingsStore, type SettingsState } from "./store";

// Settings › Plugins: the MCP servers the plugins run on. The entries live in the settings (`plugins`), their secrets in
// the keychain (the backend says only whether one is there). What a test found is kept for this session.
const st = () => useSettingsStore.getState();
const plugins = () => st().settings.plugins ?? [];
const change = (recipe: (draft: SettingsState["pluginsPage"]) => void) =>
  useSettingsStore.setState(draft => {
    recipe(draft.pluginsPage);
  });
const say = (id: string, message: Message | null) =>
  change(draft => {
    draft.messages[id] = message;
  });
const fail = (error: unknown): Message => ({ text: String(error), ok: false });
/** The whole `plugins` list saved; the main window follows through the settings event. */
const put = async (next: Plugin[]) => commit(await backend.setSettings({ ...st().settings, plugins: next }));
async function readSecrets() {
  const secrets = await backend.pluginsList();
  change(draft => {
    draft.secrets = secrets;
  });
}

/** When the page is first shown: which secrets are stored, and the servers Claude Code could hand over. */
export async function loadPlugins() {
  const imports = await backend.pluginImportList().catch(() => []);
  await readSecrets().catch(() => {});
  change(draft => {
    draft.imports = imports;
    draft.loaded = true;
  });
}

/** Save a plugin (new, or changed): `values` are the secrets typed (kept in the keychain, an empty one leaves the stored
 *  value alone), `dropped` the secret names the entry no longer has (deleted from the keychain). */
export async function savePlugin(plugin: Plugin, values: Record<string, string>, dropped: string[]) {
  const known = plugins().some(other => other.id === plugin.id);
  try {
    // the backend only touches the secrets an entry names, so the dropped ones go while the old entry still has them
    for (const name of known ? dropped : []) await backend.pluginSecret(plugin.id, name, "");
    await put(known ? plugins().map(other => (other.id === plugin.id ? plugin : other)) : [...plugins(), plugin]);
    for (const [name, value] of Object.entries(values)) if (value) await backend.pluginSecret(plugin.id, name, value);
    await readSecrets();
    say(plugin.id, { text: t("plug.saved"), ok: true });
    return true;
  } catch (error) {
    say(plugin.id, fail(error));
    return false;
  }
}

/** Start the plugin afresh and list what it offers; its first view becomes its sidebar entry. */
export async function testPlugin(id: string) {
  const busy = (on: boolean, result = st().pluginsPage.tests[id]?.result ?? null) =>
    change(draft => {
      draft.tests[id] = { busy: on, result };
    });
  busy(true);
  say(id, null);
  try {
    const found = await backend.pluginTest(id);
    await put(plugins().map(plugin => (plugin.id === id ? afterTest(plugin, found) : plugin)));
    busy(false, found);
    say(id, { text: t("plug.connected", { name: found.server?.name ?? id }), ok: true });
  } catch (error) {
    busy(false, null);
    say(id, fail(error));
  }
}

const update = async (id: string, edit: (plugin: Plugin) => Plugin) => {
  try {
    await put(plugins().map(plugin => (plugin.id === id ? edit(plugin) : plugin)));
    say(id, null);
  } catch (error) {
    say(id, fail(error));
  }
};
/** A tool the plugin's view may call, or no longer. */
export const allowTool = (id: string, tool: string, on: boolean) =>
  update(id, plugin => ({
    ...plugin,
    allowed: on
      ? [...plugin.allowed.filter(name => name !== tool), tool]
      : plugin.allowed.filter(name => name !== tool),
  }));
/** The plugin in the sidebar and running, or off. */
export const switchPlugin = (id: string, on: boolean) => update(id, plugin => ({ ...plugin, on }));

/** Remove a plugin: its server stops and its secrets leave the keychain. */
export async function removePlugin(id: string) {
  try {
    await backend.pluginForget(id);
    await put(plugins().filter(plugin => plugin.id !== id));
    change(draft => {
      delete draft.tests[id];
      delete draft.messages[id];
    });
    return true;
  } catch (error) {
    say(id, fail(error));
    return false;
  }
}

/** Take one of Claude Code's MCP servers over (its secrets go to the keychain); resolves to the new plugin's id. */
export async function importPlugin(name: string) {
  try {
    const plugin = await backend.pluginImport(name);
    await put([...plugins(), plugin]);
    await readSecrets();
    say("", null);
    return plugin.id;
  } catch (error) {
    say("", fail(error));
    return null;
  }
}
