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
/** Google calendars read through their secret iCal address; the address itself sits in the keychain, never here. */
export type CalendarCfg = { on: boolean; feeds: { email: string }[] };
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
/** Another computer in the LAN running relay-server; folders: vault project name to an absolute path on it. */
export type Machine = {
  id: string;
  name: string;
  host: string;
  port: number;
  fp: string;
  folders: Record<string, string>;
  mirror?: { on: boolean; exclude: string[] }; // "Mirror this Mac": exclude = vault folders that stay on this Mac
  default_folder?: string; // where a conversation runs when its project has no folder there; "" or none: the home
};
/** A machine in the composer's pick (`machines_list`): `default` when the project runs there without a pick. */
export type MachineChoice = { id: string; name: string; online: boolean; default: boolean };
/** What `mirror_status` says about the last sync round of a machine; `at` is unix seconds. */
export type MirrorStatus = {
  at: number;
  pushed: number;
  pulled: number;
  conflicts: string[];
  skipped: string[];
  errors: string[];
  locked: boolean;
  in_ram: boolean;
};
/** Where a running mirror round is (`mirror_progress`): root `step` of 4, `done` of `total` files, total 0 while comparing. */
export type MirrorProgress = {
  root: "context" | "plugins" | "vault" | "memory";
  step: number;
  done: number;
  total: number;
};
/** What `machine_status` says about a machine. */
export type MachineStatus = {
  ok: boolean;
  host?: string;
  version?: string;
  os?: string;
  error?: string;
  outdated?: "server" | "app"; // it answers but speaks another protocol: the side to update
};
/** What `server_setup` gives for setting up a machine: this Relay's version and the relay-server image. */
export type ServerSetup = { version: string; image: string };
export type Settings = {
  vault: string;
  vaults?: Record<string, VaultMap>; // the mapping per vault folder
  projects: Record<string, { icon?: string; img?: string; label?: string }>;
  overrides: Record<string, string | null>; // a terminal session's project, by session id
  integrations: Record<string, IntegrationConfig>;
  boards: Record<string, BoardRef>; // the board linked to a vault project
  github: { on: boolean; owners: string };
  mail: MailCfg;
  calendar: CalendarCfg;
  language?: string;
  theme?: Theme;
  accent?: Accent;
  terminal?: TerminalApp;
  favicons?: { on: boolean; last?: string; tried: Record<string, string> };
  agents: { default: string; providers: Record<string, AgentCfg> };
  sidebar?: SidebarCfg;
  machines?: Machine[];
  machines_default?: string; // where new conversations run without a pick: "" this Mac, or a machine id
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
  calendar: { on: false, feeds: [] },
  agents: { default: "claude", providers: {} },
};
export const ghOn = (settings: Settings) => !!settings.github?.on;
export const mailOn = (settings: Settings) => !!settings.mail?.on;
export const mailExperimental = (settings: Settings) => mailOn(settings) && !!settings.mail?.experimental;
export const calendarOn = (settings: Settings) => !!settings.calendar?.on && !!settings.calendar.feeds?.length;
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
