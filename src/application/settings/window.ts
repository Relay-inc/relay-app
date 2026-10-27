import { t, type Key } from "../../shared/i18n";
import type { Settings } from "../../domain/settings/types";
import * as backend from "../../infrastructure/backend";
import { storage } from "../../infrastructure/storage";
import { applyTheme, closeWindow, setTitle } from "../../infrastructure/window";
import { loadBrainStatus } from "../brain/brain";
import { initLanguage } from "./settings";
import { watchUpdates } from "./updates-page";
import { watchVaultSync } from "./vault-sync";
import { watchSharedVaults } from "./shared-vaults";
import { useSettingsStore, type SettingsTab } from "./store";

// The settings window, laid out like bb's: the pages in a sidebar on the left, the window title follows the page.
// General holds the vault folder with its mapping and the language, Projects the projects the user customised,
// Agents the coding-agent CLIs, Integrations the external services, Plugins the MCP servers that bring views, Machines the computers running relay-server, Voice dictation, Shortcuts the keys (read only), Updates Relay itself and the agent CLIs; each
// page's use cases are in <page>-page.ts and integrations.ts. Saving emits "settings-changed" from the backend, the main window follows it.
export const TABS = [
  ["general", "set.tab.general", "gear"],
  ["projects", "set.tab.projects", "folder"],
  ["agents", "set.tab.agents", "agent"],
  ["integrations", "set.tab.integrations", "plug"],
  ["plugins", "set.tab.plugins", "puzzle"],
  ["machines", "set.tab.machines", "server"],
  ["voice", "set.tab.voice", "mic"],
  ["shortcuts", "set.tab.shortcuts", "keyboard"],
  ["updates", "set.tab.updates", "refresh"],
] as const satisfies readonly (readonly [SettingsTab, Key, string])[];

const st = () => useSettingsStore.getState();
const set = useSettingsStore.setState;

/** The window's start: the settings, the vault status, the language, theme and accent, the page it was on. */
export async function initSettingsWindow() {
  const saved = await backend.getSettings();
  const vaultStatus = await backend.vaultStatus();
  const extraVaults = await backend.extraVaultsStatus();
  await initLanguage();
  applyTheme(saved.theme, saved.accent);
  // Relay › Check for Updates opens the window on Updates (src-tauri/src/lib.rs open_settings), else the last page
  const asked = (window as { __relayTab?: string | null }).__relayTab;
  const stored = asked ?? storage.getRaw("prefsTab");
  set(draft => {
    draft.settings = saved;
    draft.vaultStatus = vaultStatus;
    draft.extraVaults = extraVaults;
    draft.tab = TABS.find(x => x[0] === stored)?.[0] ?? "general";
    draft.integrations.mail.edit = { ...saved.mail, accounts: saved.mail?.accounts ?? [] };
    draft.loaded = true;
  });
  // General's sidebar views list Brain once the plugin is known, also before Integrations was opened
  void loadBrainStatus();
  void watchUpdates();
  void watchVaultSync();
  // an invite link that opened Relay: the join form (the backend opens the window on Machines)
  void watchSharedVaults();
  showTitle();
  void backend.onSettingsGo(to => {
    const tab = TABS.find(x => x[0] === to)?.[0];
    if (tab) go(tab);
  });
}
/** The window title follows the page (call after the page or the language changed). */
export const showTitle = () => setTitle(t(TABS.find(x => x[0] === st().tab)![1]));
export function go(to: SettingsTab) {
  storage.setRaw("prefsTab", to);
  set(draft => {
    draft.tab = to;
    draft.message = null;
  });
  showTitle();
}
/** Escape and Cmd-W close the window. */
export const close = closeWindow;
/** A web link (Google's app password page) opens in the browser, the settings window never navigates. */
export const openLink = (url: string) => backend.openUrl(url);

/** The settings saved, with the vault status read again (General and Projects); `done` is the message to show when
 *  it worked, none when empty. */
export async function save(next: Settings, done = "") {
  try {
    const saved = await backend.setSettings(next);
    const vaultStatus = await backend.vaultStatus();
    const extraVaults = await backend.extraVaultsStatus();
    set(draft => {
      draft.settings = saved;
      draft.vaultStatus = vaultStatus;
      draft.extraVaults = extraVaults;
      draft.message = done ? { text: done, ok: true } : null;
    });
  } catch (e) {
    set(draft => {
      draft.message = { text: String(e), ok: false };
    });
  }
}
/** A change saved by a page itself (Agents, Integrations): the window keeps what the backend answered. */
export const commit = (saved: Settings) =>
  set(draft => {
    draft.settings = saved;
  });
