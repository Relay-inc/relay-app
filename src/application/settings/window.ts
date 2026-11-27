import { t, type Key } from "../../shared/i18n";
import type { Settings } from "../../domain/settings/types";
import * as backend from "../../infrastructure/backend";
import { storage } from "../../infrastructure/storage";
import { applyTheme, closeWindow, setTitle } from "../../infrastructure/window";
import { initLanguage } from "./settings";
import { watchUpdates } from "./updates-page";
import { watchVaultSync } from "./vault-sync";
import { useSettingsStore, type SettingsTab } from "./store";

// The settings window, laid out like bb's: the pages in a sidebar on the left, the window title follows the page.
// General holds how Relay looks (appearance, language, terminal, the sidebar), Vault the vault folder with its
// mapping and git backup, Projects the projects the user customised, Agents the coding-agent CLIs (and where
// conversations run), Integrations the external services, Plugins the MCP servers that bring views, Voice dictation,
// Shortcuts the keys, Automation what Relay does on its own, Privacy & access what macOS lets Relay do and what agents
// may do with the user's tools, Labs the features still being tried, Updates Relay itself and the agent CLIs; each
// page's use cases are in <page>-page.ts and integrations.ts. Saving emits "settings-changed" from the backend, the main window follows it.
const PAGES = {
  general: ["set.tab.general", "gear"],
  vault: ["set.tab.vault", "vault"],
  shortcuts: ["set.tab.shortcuts", "keyboard"],
  voice: ["set.tab.voice", "mic"],
  projects: ["set.tab.projects", "folder"],
  agents: ["set.tab.agents", "agent"],
  integrations: ["set.tab.integrations", "plug"],
  plugins: ["set.tab.plugins", "puzzle"],
  automation: ["set.tab.automation", "flash"],
  access: ["set.tab.access", "shield"],
  updates: ["set.tab.updates", "refresh"],
  labs: ["set.tab.labs", "flask"],
} as const satisfies Record<SettingsTab, readonly [Key, string]>;
/** The nav's groups: the app, what Relay works with, what runs on its own and what it may touch, housekeeping. */
const GROUPS: SettingsTab[][] = [
  ["general", "vault", "shortcuts", "voice"],
  ["projects", "agents", "integrations", "plugins"],
  ["automation", "access"],
  ["updates", "labs"],
];
const row = (id: SettingsTab) => [id, PAGES[id][0], PAGES[id][1]] as const;
export const TAB_GROUPS = GROUPS.map(group => group.map(row));
export const TABS = TAB_GROUPS.flat();

/** Pages that moved to Organisations and servers, and what opens there for them. */
const MOVED: Record<string, string> = { workspaces: "join", machines: "mac", organisation: "" };

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
  void watchUpdates();
  void watchVaultSync();
  showTitle();
  // machines, workspaces and organisations are on Organisations and servers in the main window: asked for here (an
  // invite link that opened Relay asks for "workspaces"), the window sends it there and closes
  if (asked && asked in MOVED) return void openServersPage(MOVED[asked]);
  void backend.onSettingsGo(to => {
    const tab = TABS.find(x => x[0] === to)?.[0];
    if (tab) go(tab);
    else if (to in MOVED) void openServersPage(MOVED[to]);
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
/** Organisations and servers is a page in the main window: it opens there with `item` picked and this window closes. */
export async function openServersPage(item = "") {
  try {
    await backend.openServersInMain(item);
  } finally {
    closeWindow();
  }
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
