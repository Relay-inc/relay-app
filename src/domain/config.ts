import { invoke } from "@tauri-apps/api/core";
import type { BoardRef } from "./providers";
import type { VaultMap } from "./vault-setup";

// The app's settings as the backend keeps them (settings.json): the main window reads them, the settings window edits them.
/** One integration's settings.integrations.<id>: whether it is on, and its provider's own fields (strings, a checkbox). */
export type IntegrationConfig = { on?: boolean; [field: string]: string | boolean | undefined };
export type MailAcct = {
  email: string;
  keychain_service: string;
  keychain_account: string;
  host?: string;
  port?: number;
}; // no host: Gmail
export type MailCfg = { on: boolean; account: string; accounts: MailAcct[] };
/** An agent provider's settings: switched on, the program, and its own options (Codex' sandbox, …). */
export type AgentCfg = { on: boolean; bin: string; [opt: string]: unknown };
/** The colour scheme: macOS's, or always light or dark. */
export type Theme = "system" | "light" | "dark";
/** The accent: Relay blue, or graphite (the text colour). */
export type Accent = "relay" | "graphite";
/** The terminal "Open in Terminal" uses: the first one installed (iTerm, WezTerm, Terminal), or a fixed one. */
export type TerminalApp = "auto" | "iterm" | "wezterm" | "terminal";
/** The views on top of the sidebar: rows with names or a row of icons, the order they were dragged in, the ones switched off. */
export type SidebarCfg = { layout?: "list" | "icons"; order?: string[]; hidden?: string[] };
export type Settings = {
  vault: string;
  vaults?: Record<string, VaultMap>; // the mapping per vault folder
  projects: Record<string, { icon?: string; img?: string; label?: string }>;
  overrides: Record<string, string | null>; // a terminal session's project, by session id
  integrations: Record<string, IntegrationConfig>;
  boards: Record<string, BoardRef>; // the board linked to a vault project
  github: { on: boolean; owners: string };
  mail: MailCfg;
  language?: string;
  theme?: Theme;
  accent?: Accent;
  terminal?: TerminalApp;
  favicons?: { on: boolean; last?: string; tried: Record<string, string> };
  agents: { default: string; providers: Record<string, AgentCfg> };
  sidebar?: SidebarCfg;
};

export const config = {
  value: {
    vault: "",
    projects: {},
    overrides: {},
    integrations: {},
    boards: {},
    github: { on: false, owners: "" },
    mail: { on: false, account: "", accounts: [] },
    agents: { default: "claude", providers: {} },
  } as Settings,
  msg: "", // why the last save failed
};
export const ghOn = () => !!config.value.github?.on;
export const mailOn = () => !!config.value.mail?.on;

export async function saveSettings(next: Settings) {
  try {
    config.value = await invoke<Settings>("set_settings", { settings: next });
    config.msg = "";
    return true;
  } catch (e) {
    config.msg = String(e);
    return false;
  }
}
