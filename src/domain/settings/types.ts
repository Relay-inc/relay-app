import type { BoardRef } from "../board/types";
import type { VaultMap } from "../workspace/types";

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
/** `experimental`: archive, delete, the Inbox/Other split and bulk actions (Settings › Mail). */
export type MailCfg = { on: boolean; account: string; accounts: MailAcct[]; experimental?: boolean };
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

/** The settings before the backend answered. */
export const EMPTY_SETTINGS: Settings = {
  vault: "",
  projects: {},
  overrides: {},
  integrations: {},
  boards: {},
  github: { on: false, owners: "" },
  mail: { on: false, account: "", accounts: [] },
  agents: { default: "claude", providers: {} },
};
export const ghOn = (settings: Settings) => !!settings.github?.on;
export const mailOn = (settings: Settings) => !!settings.mail?.on;
export const mailExperimental = (settings: Settings) => mailOn(settings) && !!settings.mail?.experimental;
/** A message under a settings section: what the last action said, and whether it worked. */
export type Message = { text: string; ok: boolean };
/** What the integrations page has typed for a board provider, by id: `tok-<provider>` for the token,
 *  `f-<provider>-<field>` for a field (a string, or a boolean for a checkbox). A field not in it keeps its stored value. */
export type BoardForm = Record<string, string | boolean>;
/** What sits in the mail add fields. */
export type MailNew = {
  email: string;
  keychain_service: string;
  keychain_account: string;
  password: string;
  host: string;
  port: string;
};
export const NO_MAIL_DRAFT: MailNew = {
  email: "",
  keychain_service: "",
  keychain_account: "",
  password: "",
  host: "",
  port: "993",
};
/** How an agent may run an extension's action through `relay`: on its own, after asking, or never. */
export type Policy = "auto" | "ask" | "deny";
export type ActionMeta = { ext: string; id: string; about: string; write: boolean; default: Policy };
/** An extension's entry in the vault's .relay/config.json `actions`: `access` and a policy per action or `*`. */
export type ActionEntry = Record<string, string | boolean>;
export type ActionConfig = { actions: ActionMeta[]; config: Record<string, ActionEntry | string> };
