import { t } from "../../shared/i18n";
import { afterTest } from "../../domain/plugins/rules";
import type { Plugin, PluginCard } from "../../domain/plugins/types";
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
  const before = plugins().find(other => other.id === plugin.id);
  const known = !!before;
  try {
    // the backend only touches the secrets an entry names, so the dropped ones go while the old entry still has them
    for (const name of known ? dropped : []) await backend.pluginSecret(plugin.id, name, "");
    await put(known ? plugins().map(other => (other.id === plugin.id ? plugin : other)) : [...plugins(), plugin]);
    for (const [name, value] of Object.entries(values)) if (value) await backend.pluginSecret(plugin.id, name, value);
    await readSecrets();
    // Claude Code gets a launcher that reads the plugin's entry and secrets itself, so a save only matters to it when the
    // switch changed or the name it knows the plugin by did
    let synced: Message | null = null;
    const was = before ? (before.mcp ?? before.id) : undefined;
    const now = plugin.mcp ?? plugin.id;
    try {
      if (plugin.sync && (!before?.sync || was !== now))
        await backend.pluginClaudeSync(plugin.id, before?.sync && was !== now ? was : undefined);
      else if (!plugin.sync && before?.sync && was) await backend.pluginClaudeRemove(was);
    } catch (error) {
      synced = fail(error);
    }
    say(plugin.id, synced ?? { text: t("plug.saved"), ok: true });
    return true;
  } catch (error) {
    say(plugin.id, fail(error));
    return false;
  }
}

/** Start the plugin afresh and list what it offers; its views become its sidebar entry, a tab each. */
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
// A save rewrites every setting through the backend (vault check, .relay/config.json, tray), which is too slow to wait
// on for each switch: the switches change the store at once and one save follows when they stop changing.
const SAVE_AFTER_MS = 400;
let pendingAllowed: ReturnType<typeof setTimeout> | undefined;
/** The tools the plugin's view may call, as a whole list: shown at once, saved shortly after. A failed save puts the
 *  saved settings back and says why. */
export function setAllowed(id: string, allowed: string[]) {
  useSettingsStore.setState(draft => {
    const plugin = draft.settings.plugins?.find(other => other.id === id);
    if (plugin) plugin.allowed = allowed;
  });
  clearTimeout(pendingAllowed);
  pendingAllowed = setTimeout(async () => {
    try {
      await put(plugins());
      say(id, null);
    } catch (error) {
      say(id, fail(error));
      commit(await backend.getSettings());
    }
  }, SAVE_AFTER_MS);
}
/** A tool the plugin's view may call, or no longer. */
export const allowTool = (id: string, tool: string, on: boolean) => {
  const allowed = plugins().find(plugin => plugin.id === id)?.allowed ?? [];
  setAllowed(id, on ? [...allowed.filter(name => name !== tool), tool] : allowed.filter(name => name !== tool));
};
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
    // read its views right away, as a save does, so it lands in the sidebar
    await testPlugin(plugin.id);
    return plugin.id;
  } catch (error) {
    say("", fail(error));
    return null;
  }
}

// ---------- from GitHub

/** Download `owner/repo[@ref]` and read it: the card to confirm, nothing has run. */
export const fetchPlugin = (spec: string) => backend.pluginGithubFetch(spec);
/** The user said no to a card: its download goes. */
export const dropDownload = (card: PluginCard) => backend.pluginGithubCancel(card.stage).catch(() => {});

/** Confirmed: put the download in place, run its install command and save the entry (which starts the server and reads its
 *  tools and views, as a save does). `sync` also registers it in Claude Code. Resolves to the plugin's id, null with the
 *  reason in the plugin's message when it failed. */
export async function installPlugin(card: PluginCard, sync: boolean) {
  try {
    const plugin = await backend.pluginInstall(card.stage, sync);
    if (!(await savePlugin(plugin, {}, []))) return null;
    await testPlugin(plugin.id);
    return plugin.id;
  } catch (error) {
    say(card.id, fail(error));
    return null;
  }
}

/** The card for a newer commit of the plugin's ref, null when it is up to date. */
export const checkUpdate = (id: string) => backend.pluginGithubCheck(id);

/** Confirmed update: the new download replaces the folder (the old one comes back when the install command fails), then the
 *  manifest's command, arguments, environment and secrets are the entry's, with what the user set (on, allowed tools) kept. */
export async function updatePlugin(card: PluginCard) {
  const old = plugins().find(plugin => plugin.id === card.id);
  if (!old) return false;
  try {
    const fresh = await backend.pluginInstall(card.stage, old.sync ?? false);
    const next: Plugin = {
      ...old,
      name: fresh.name,
      command: fresh.command,
      args: fresh.args,
      env: fresh.env,
      secrets: fresh.secrets,
      mcp: fresh.mcp ?? null,
      source: fresh.source,
    };
    if (
      !(await savePlugin(
        next,
        {},
        old.secrets.filter(name => !fresh.secrets.includes(name)),
      ))
    )
      return false;
    await testPlugin(old.id);
    return true;
  } catch (error) {
    say(old.id, fail(error));
    return false;
  }
}

/** Whether Claude Code already has a server of that name (switching the sync on then replaces it). */
export const claudeHas = (name: string) => backend.pluginClaudeHas(name).catch(() => false);
