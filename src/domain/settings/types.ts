import type { BoardRef } from "../board/types";
import type { BuddyRef } from "../buddy/rules";
import type { VoiceCfg } from "./voice";
import type { VaultMap } from "../workspace/types";
import type { Pipeline } from "../pipeline/types";
import type { Plugin } from "../plugins/types";

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
/** `more`: the "…" that lists the switched-off views, shown unless it is false. */
export type SidebarCfg = {
  layout?: "list" | "icons";
  order?: string[];
  hidden?: string[];
  more?: boolean;
};
/** Another computer in the LAN running relay-server. */
export type Machine = {
  id: string;
  name: string;
  host: string;
  port: number;
  fp: string;
  mirror?: { exclude: string[] }; // vault folders that stay on this Mac, out of the machine's mirror
  sharedOnly?: boolean; // paired for shared vaults only: no mirror and no conversations there
  auto?: boolean; // shared vaults only, added because this Mac is admin of a vault there: goes again with that role
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
  /** deletes of the last round that wait for the user, "<root>/<path>" */
  held: string[];
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
  update?: boolean; // it takes an update from Relay (machine_update), not Relay on a Mac
  repos?: boolean; // it clones repos and connects to GitHub, false for a relay-server from before that
};
/** GitHub on a machine (`machine_github`). `state`: off, pending (a code waits to be typed), on, locked (a token, but
 *  the mirror's key is not there yet), expired, denied or error (with `error`). `since`: YYYY-MM-DD. `name` and `email`:
 *  what the machine's commits say. */
export type MachineGithub = { state: string; login: string; since: string; name: string; email: string; error: string };
/** Connecting a machine to GitHub: type `user_code` at `verification_uri` before `expires_in` s, asked every `interval` s. */
export type DeviceCode = { user_code: string; verification_uri: string; expires_in: number; interval: number };
/** A repo on a machine: its folder `name`, `repo` the owner/repo of its origin, the branch checked out, whether it has
 *  work not committed and how many commits are not pushed. */
export type MachineRepo = {
  name: string;
  path: string;
  repo: string;
  branch: string;
  dirty: boolean;
  unpushed: number;
};
/** What `server_setup` gives for setting up a machine: this Relay's version and the relay-server image. */
export type ServerSetup = { version: string; image: string; dev?: boolean }; // dev: a development build, version "latest"
/** This Mac as a work machine (`host_status`): Relay's own relay-server under a LaunchAgent. */
/** A pairing made for a phone of this Mac on a machine: the line (it carries the mirror's key) and the same as a QR (SVG). */
export type PhonePairing = { line: string; qr: string; ntfy: string }; // ntfy: the topic for the phone's notifications
export type HostStatus = {
  supported: boolean; // false in a development build: launchd can only run the Relay installed in Applications
  on: boolean; // the LaunchAgent is installed
  running: boolean; // and its server is running
  ram: boolean; // the mirror's working copy is on a RAM disk
  fingerprint: string;
  clients: string[]; // names of the paired devices
};
/** What a member may do in a shared vault: an admin also invites and removes members, a reader only reads. */
export type SharedRole = "admin" | "member" | "reader";
/** A shared vault on a relay-server (src-tauri/src/shared_vaults.rs): the server it lives on (pinned by `fp`), its
 *  folder on this Mac and this Mac's role there. Only the backend writes the list. */
export type SharedVault = {
  id: string;
  name: string;
  host: string;
  port: number;
  fp: string;
  folder: string;
  role: SharedRole;
};
/** The last sync round of a shared vault (`shared_vaults_status`): `at` in epoch seconds, the counts since the app
 *  started, the conflict copies made, the deletes held for the user, and `bad` files that do not open with the key. */
export type SharedStatus = {
  at: number;
  pushed: number;
  pulled: number;
  conflicts: string[];
  errors: string[];
  held: string[];
  bad: number;
  live?: boolean; // the live channel is connected; false or missing: rounds every 10 s only
  // what the member list says is wrong: a list the server cannot be trusted on, another member who saw a newer one, a
  // removal that waits too long for its key change
  warnings?: string[];
  rekeying?: boolean; // someone left and the key has not changed yet
  changed?: { fp: string; name: string }[]; // members whose Relay publishes other keys than the member list has
  docs?: boolean; // an admin turned on making the workspace's notes documents (the member list says so)
  admin?: boolean; // this Mac is an admin of the member list: it may turn that on or off, and make members admins
  admins?: string[] | null; // the member list's admins (fingerprints); null while the workspace has no list
  listed?: string[] | null; // every member on the member list (fingerprints); null while the workspace has no list
  people?: SharedPerson[] | null; // the member list's people with their devices; null while the workspace has no list
  reader?: boolean; // this Mac only reads the workspace: its rounds only pull
  readers?: string[] | null; // the member list's readers (fingerprints), null while the workspace has no list
  unsent?: number; // a reader's changes in the folder that its rounds leave out
  nohistory?: boolean; // made without history (the member list's `nohistory`): its conflict copies name no Mac
  policy?: SharedPolicy | null; // the workspace's signed policy (docs/workspaces.md, Policy), null or missing: none
};
/** A workspace's signed policy: the agent providers it allows (claude, codex) and whether capture is on. */
export type SharedPolicy = { providers: string[]; capture: boolean };
/** The agent providers a workspace policy may allow (relay-remote members.rs POLICY_PROVIDERS). */
export const POLICY_PROVIDERS = ["claude", "codex"];
/** A server's organisation as this Mac sees it (src-tauri/src/organisation.rs `org_status`): `me` an organisation
 *  admin, `owner` the device that may start it, `code` this Mac's keys' code (to compare), `admins` fingerprints. */
export type OrgStatus = { exists: boolean; me: boolean; owner: boolean; code: string; admins: string[] };
/** A workspace in the organisation's overview: what its member list says, nothing of its notes. `managed`: every
 *  organisation admin is an admin of it, `admin`: this Mac is one. */
export type OrgWorkspace = {
  id: string;
  name: string;
  list: boolean;
  managed: boolean;
  admin: boolean;
  nohistory: boolean;
  members: { fp: string; name: string; role: SharedRole | ""; person: string; listed: boolean }[];
  people: SharedPerson[];
};
/** A person across the server's workspaces, grouped by a device or an email they share. */
export type OrgPerson = {
  name: string;
  email: string;
  devices: { fp: string; name: string }[];
  workspaces: { id: string; name: string; role: SharedRole | "" }[];
};
/** The overview (`org_overview`): workspaces, people, admins, and devices that published keys to be added (`code`
 *  null when what they published is not signed by them). */
export type OrgOverview = {
  workspaces: OrgWorkspace[];
  people: OrgPerson[];
  admins: { fp: string; name: string }[];
  candidates: { fp: string; name: string; code: string | null }[];
};
/** What an offboarding did: the workspaces it took the person off, the ones this Mac is no admin of, the failures and
 *  how many devices the server revoked. */
export type OrgOffboard = {
  removed: string[];
  skipped: string[];
  failed: { name: string; error: string }[];
  revoked: number;
};
/** A person on a shared vault's member list (docs/workspaces.md, People): `who` its id, `devices` fingerprints. */
export type SharedPerson = { who: string; name: string; email: string; devices: string[] };
/** An open invite of a shared vault: single use, `expires` in epoch seconds. */
export type SharedInvite = { id: string; role: SharedRole; expires: number };
/** A shared vault's members and open invites (`shared_vault_info`), and `me`: this Mac's fingerprint. */
export type SharedInfo = {
  vault: {
    id: string;
    name: string;
    role: SharedRole;
    members: { name: string; fp: string; role: SharedRole; added: number }[];
    people?: SharedPerson[]; // as the server reads the member list (a member's Mac checks it itself: `SharedStatus`)
    invites: SharedInvite[];
  };
  me: string;
};
export type Settings = {
  vault: string;
  vaults?: Record<string, VaultMap>; // the mapping per vault folder
  extraVaults?: string[]; // other vault folders whose projects show next to the main vault's
  sharedVaults?: SharedVault[]; // the vaults shared on a relay-server, kept by the backend (set_settings ignores them)
  projects: Record<string, { icon?: string; img?: string; label?: string }>;
  overrides: Record<string, string | null>; // a terminal session's project, by session id
  integrations: Record<string, IntegrationConfig>;
  boards: Record<string, BoardRef>; // the board linked to a vault project
  pipelines?: Record<string, Pipeline>; // the board pipeline of a vault project (domain/pipeline)
  buddy?: Record<string, BuddyRef>; // the Buddy project linked to a vault project (domain/buddy)
  github: { on: boolean; owners: string };
  mail: MailCfg;
  calendar: CalendarCfg;
  language?: string;
  theme?: Theme;
  accent?: Accent;
  terminal?: TerminalApp;
  keepAwake?: boolean; // hold off idle sleep while a turn runs, on unless false
  voice?: VoiceCfg; // Settings › Voice (domain/settings/voice.ts)
  shortcuts?: Record<string, string[]>; // Settings › Shortcuts, what differs from the defaults (domain/settings/shortcuts.ts)
  autoRetry?: boolean; // send a turn refused for a limit again once it resets, off unless true
  timeFromSessions?: boolean; // Today proposes the day's Productive time from the conversations, on unless false
  gitDrawer?: boolean; // the Git drawer in a project conversation's title bar, off unless true
  workerCrabs?: boolean; // the orchestrator's workers as pixel crabs in their list (ui/features/orchestrator/Crab), on unless false
  captureOnClose?: boolean; // write vault updates when a conversation closes (application/today/capture), on unless false
  favicons?: { on: boolean; last?: string; tried: Record<string, string> };
  agents: { default: string; providers: Record<string, AgentCfg> };
  plugins?: Plugin[]; // the MCP servers (domain/plugins), their secrets are in the keychain
  sidebar?: SidebarCfg;
  machines?: Machine[];
  experimental?: { files?: boolean }; // features to try first, off by default (Settings › General › Experimental)
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
/** Files: the Pages tab, a note as a page and what builds on it (Settings › General › Experimental), off until switched
 *  on. Team documents keep syncing in the backend either way. */
export const filesOn = (settings: Settings) => !!settings.experimental?.files;
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
/** The vault's git backup (src-tauri/src/vaultsync.rs): the remote, whether it runs and every how many minutes, and the
 *  last round (`at` in epoch seconds, `commit` null when nothing changed), null before the first. */
export type VaultSync = {
  remote: string;
  on: boolean;
  minutes: number;
  last: { at: number; ok: boolean; error: string; commit: string | null } | null;
};
