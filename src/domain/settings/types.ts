import type { BoardRef } from "../board/types";
import type { VaultMap } from "../workspace/types";

// The app's settings as the backend keeps them (settings.json): the main window reads them, the settings window edits them.
/** One integration's settings.integrations.<id>: whether it is on, and its provider's own fields (strings, a checkbox). */
export type IntegrationConfig = { on?: boolean; [field: string]: string | boolean | undefined };
export type MailAcct = { email: string; keychain_service: string; keychain_account: string };
export type MailCfg = { on: boolean; account: string; accounts: MailAcct[] };
/** An agent provider's settings: switched on, the program, and its own options (Codex' sandbox, …). */
export type AgentCfg = { on: boolean; bin: string; [opt: string]: unknown };
/** The colour scheme: macOS's, or always light or dark. */
export type Theme = "system" | "light" | "dark";
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
  favicons?: { on: boolean; last?: string; tried: Record<string, string> };
  agents: { default: string; providers: Record<string, AgentCfg> };
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
/** A message under a settings section: what the last action said, and whether it worked. */
export type Message = { text: string; ok: boolean };
/** What the integrations page has typed for a board provider, by id: `tok-<provider>` for the token,
 *  `f-<provider>-<field>` for a field (a string, or a boolean for a checkbox). A field not in it keeps its stored value. */
export type BoardForm = Record<string, string | boolean>;
/** What sits in the mail add fields. */
export type MailNew = { email: string; keychain_service: string; keychain_account: string; password: string };
export const NO_MAIL_DRAFT: MailNew = { email: "", keychain_service: "", keychain_account: "", password: "" };
