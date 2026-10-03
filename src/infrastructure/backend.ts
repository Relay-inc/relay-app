import { Channel, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import type { AgentEvent, AgentsStatus, Decision } from "../domain/agents/types";
import type { SlashCommand } from "../domain/conversations/commands";
import type { AgentSession, Pending, SessionOf, Sub, Transcript } from "../domain/conversations/types";
import type {
  ActionConfig,
  ActionEntry,
  Machine,
  MachineChoice,
  MachineStatus,
  MirrorProgress,
  MirrorStatus,
  ServerSetup,
  MailAcct,
  Settings,
} from "../domain/settings/types";
import type { IconKind, ProjectIcon, Snapshot, VaultMap, VaultNotes, VaultStatus } from "../domain/workspace/types";
import type { Mail, MailBody } from "../domain/mail/types";
import type { Meetings } from "../domain/calendar/types";
import type { PrDetail, PRs } from "../domain/pull-requests/types";
import type { AllTokens, ProvLimits } from "../domain/usage/types";

// Every Tauri command the webview calls and every event it listens to, one typed function each (src-tauri/src/lib.rs
// has the other half). Nothing else in the app calls `invoke` or `listen`. The arguments are the backend's, unchanged.

// ---------- files attached by their path (src-tauri/src/files.rs)
/** The files picked in the open dialog, as paths. */
export const pickFiles = () => invoke<string[]>("pick_files");
/** A picture at a path as [media type, base64], to send it inline. */
export const readImage = (path: string) => invoke<[string, string]>("read_image", { path });
/** An attached file in its default app, or shown in Finder (`reveal`). Rejects when it is gone. */
export const openFile = (path: string, reveal: boolean) => invoke("open_file", { path, reveal });
/** The files copied in Finder, as paths: empty when the clipboard holds none. */
export const pastedFiles = () => invoke<string[]>("pasted_files");
/** Files dragged over the window from Finder: `over` while they hover, then the dropped paths. */
export const onFileDrop = (handler: (event: { over: boolean; paths?: string[] }) => void) =>
  getCurrentWebview().onDragDropEvent(e => {
    const { type } = e.payload;
    if (type === "enter" || type === "over") handler({ over: true });
    else if (type === "leave") handler({ over: false });
    else handler({ over: false, paths: e.payload.paths });
  });

// ---------- settings, language, windows
export const getSettings = () => invoke<Settings>("get_settings");
export const setSettings = (settings: Settings) => invoke<Settings>("set_settings", { settings });
/** The language from the settings ("system" or a code), resolved by the backend: the first macOS preferred language the
 * app has. Not navigator.language: WKWebView derives it from the bundle's localizations, not the macOS language list. */
export const uiLang = () => invoke<string>("ui_lang");
/** The macOS locale in the UI language (nl-BE for nl), for dates and sorting. */
export const uiLocale = () => invoke<string>("ui_locale");
export const openSettingsWindow = () => invoke("open_settings_window");
/** A web or mail link in the default browser or mail app: a webview window cannot open them itself. */
export const openUrl = (url: string) => invoke("plugin:opener|open_url", { url });
/** A banner; a click opens `key` (src-tauri/src/notify.rs). A newer banner replaces the one in its `slot`, the key
 *  when left out. */
export const notify = (key: string, title: string, body: string, slot?: string) =>
  invoke("notify", { key, title, body, ...(slot ? { slot } : {}) });

// ---------- the vault
export const vaultStatus = () => invoke<VaultStatus>("vault_status");
export const snapshot = () => invoke<Snapshot>("snapshot");
export const vaultNotes = () => invoke<VaultNotes>("vault_notes");
export const readNote = (target: string) => invoke<unknown>("read_note", { target });
export const pickFolder = () => invoke<string | null>("pick_folder");
export const pickPath = (folder: boolean, start: string) => invoke<string | null>("pick_path", { folder, start });
export const detectVault = (path: string) => invoke<VaultStatus>("detect_vault", { path });
export const checkVault = (path: string, map: VaultMap) => invoke<VaultStatus>("check_vault", { path, map });
export const projectIcons = () => invoke<Record<string, ProjectIcon>>("project_icons");
export const setProjectIcon = (project: string, kind: IconKind, value: string) =>
  invoke("set_project_icon", { project, kind, value });
export const favicons = (projects: { name: string; aliases: string[] }[]) =>
  invoke<Record<string, { site: string; data: string | null }>>("favicons", { projects });
export const findIconSites = (projects: { name: string; context: string; summary: string }[]) =>
  invoke<Record<string, string>>("find_icon_sites", { projects });
export const projectRepos = () => invoke<Record<string, string[]>>("project_repos");
export const setProjectRepos = (project: string, repos: string[]) => invoke("set_project_repos", { project, repos });
/** A GitHub repo no project has, an answered "not now": no conversation asks about it again. */
export const ignoreRepo = (repo: string) => invoke("ignore_repo", { repo });
export const reminder = (action: "done" | "push", id: string, date: string | null) =>
  invoke("reminder", { action, id, date });
export const reminderAdd = (text: string, date: string, project: string | null, repeat: string | null) =>
  invoke("reminder_add", { text, date, project, repeat });

// ---------- agents and conversations
export const agentsStatus = () => invoke<AgentsStatus>("agents_status");
/** A provider's slash commands and skills for the current vault. */
export const agentCommands = (provider: string) => invoke<SlashCommand[]>("agent_commands", { provider });
/** Every conversation key the backend has a session for (older versions' keys too). */
export const chats = () => invoke<string[]>("chats");
export const chatProviders = () => invoke<Record<string, string>>("chat_providers");
type SendArgs = {
  project: string;
  text: string;
  images: { media_type: string; data: string }[];
  name: string;
  fork: string | null;
  mail: boolean;
  model: string;
  effort: string;
  provider: string;
  projectName: string | null; // the conversation's project: a project bound to a machine runs there
  machine: string | null; // where a new conversation runs: "" this Mac, a machine id, null the project's machine
  /** The project to tell the agent about; the backend puts the project line in front of `text`. */
  told: string | null;
  context: string | null;
};
export const send = (args: SendArgs) => invoke("send", args);
export const stop = (project: string) => invoke("stop", { project });
/** Removes the git worktrees a conversation made; the ones with work git would lose stay. */
export const dropWorktrees = (project: string) =>
  invoke<{ removed: number; kept: number }>("drop_worktrees", { project });
export const answer = (id: string, decision: Decision) => invoke("answer", { id, decision });
/** A background or terminal session: hide is the app's own, stop and attach (open in iTerm) go to the backend. */
export const backgroundSession = (action: "stop" | "attach", id: string) => invoke("bg", { action, id });
export const openTerminal = (project: string, session: string | null, name: string) =>
  invoke("open_terminal", { project, session, name });
export const aiTitle = (text: string, provider: string) => invoke<string>("ai_title", { text, provider });
export const agentLog = (key: string, id: string) => invoke<string[]>("agent_log", { key, id });
export const history = (project: string) => invoke<AgentEvent[]>("history", { project });
/** A transcript by session id from an offset; `provider` for an app conversation's session, none for a terminal one. */
export const historySid = (sid: string, from: number, provider?: string) =>
  invoke<Transcript<AgentEvent>>("history_sid", provider === undefined ? { sid, from } : { sid, from, provider });
/** The conversations whose process the app runs, with the turns each has in flight (0: idle but alive). */
export const running = () => invoke<Record<string, number>>("running");
export const pending = () => invoke<Pending[]>("pending");
export const subagents = (keys: string[]) => invoke<Record<string, Sub[]>>("subagents", { keys });
export const agents = () => invoke<AgentSession[]>("agents");
export const appSids = () => invoke<string[]>("app_sids");
export const appSessions = () => invoke<SessionOf>("app_sessions");

// ---------- work machines (relay-server in the LAN)
/** The machine each conversation runs on, by conversation key. */
export const chatMachines = () => invoke<Record<string, { machine: string; id: string; cwd: string }>>("chat_machines");
/** Moves a conversation, between two turns, to another place: "" this Mac, or a machine id. */
export const moveConversation = (key: string, to: string, projectName: string | null, mail: boolean) =>
  invoke("move_conversation", { key, to, projectName, mail });
/** Every paired machine as the backend last heard it, no network: for the composer's pick. */
export const machinesList = (project: string | null) => invoke<MachineChoice[]>("machines_list", { project });
/** Pairs with the line `relay-server pair` printed; the backend saves the machine and emits settings-changed. */
export const machinePair = (line: string, name: string) => invoke<Machine>("machine_pair", { line, name });
export const machineStatus = (id: string) => invoke<MachineStatus>("machine_status", { id });
/** This Relay's version and the relay-server image that speaks its protocol, for setting up a machine. */
export const serverSetup = () => invoke<ServerSetup>("server_setup");
export const machineForget = (id: string) => invoke("machine_forget", { id });
export const setMachineFolders = (id: string, folders: Record<string, string>) =>
  invoke("set_machine_folders", { id, folders });
/** Where new conversations run without a pick ("" this Mac); the backend emits settings-changed. */
export const setMachinesDefault = (id: string) => invoke("set_machines_default", { id });
/** Turns "Mirror this Mac" on or off for a machine; exclude = vault folders that stay on this Mac. */
export const setMachineMirror = (id: string, on: boolean, exclude: string[]) =>
  invoke("set_machine_mirror", { id, on, exclude });
/** The last sync round of a machine's mirror, null before the first. */
export const mirrorStatus = (id: string) => invoke<MirrorStatus | null>("mirror_status", { id });
/** Where the running round of a machine's mirror is, null between rounds. */
export const mirrorProgress = (id: string) => invoke<MirrorProgress | null>("mirror_progress", { id });
/** Removes the copy on the machine and turns its mirror off. */
export const mirrorWipe = (id: string) => invoke("mirror_wipe", { id });
/** The folder used on the machine when a project has none there; "" the machine's home. */
export const setMachineDefaultFolder = (id: string, folder: string) =>
  invoke("set_machine_default_folder", { id, folder });

// ---------- usage
export const usageLimits = () => invoke<ProvLimits[]>("usage_limits");
export const usageTokens = (period: { today: number; week: number }) => invoke<AllTokens>("usage_tokens", period);

// ---------- GitHub
export const githubPrs = () => invoke<PRs>("github_prs");
export const githubPr = (repo: string, number: number) => invoke<PrDetail>("github_pr", { repo, number });
export const githubStatus = () => invoke<string>("github_status");

// ---------- mail
export const mailList = (account: string, page: number) => invoke<Mail[]>("mail_list", { account, page });
export const mailRead = (account: string, id: string) => invoke<MailBody>("mail_read", { account, id });
export const mailSeen = (account: string, id: string, seen: boolean) => invoke("mail_seen", { account, id, seen });
/** Archive (`trash` false) or move to Trash, the mails the user picked. The backend refuses with the experimental mail flag off. */
export const mailMove = (account: string, ids: string[], trash: boolean) =>
  invoke<void>("mail_move", { account, ids, trash });
/** Gmail without a server; a generic IMAP account with its host and port. */
export const mailConnect = (email: string, password: string, imap?: { host: string; port: number }) =>
  invoke<{ account: MailAcct; result: string }>("mail_connect", { email, password, ...imap });
export const mailTest = (account: MailAcct) => invoke<string>("mail_test", { account });

// ---------- calendar (read-only; the secret iCal address goes to the keychain and never comes back)
/** Save a calendar's secret iCal address in the keychain after a test fetch: the meetings in the next 7 days. An empty
 *  address removes it. */
export const calendarConnect = (email: string, url: string) => invoke<number>("calendar_connect", { email, url });
/** The meetings of every switched-on calendar from an hour ago to 12 hours ahead. */
export const calendarMeetings = () => invoke<Meetings>("calendar_meetings");

// ---------- board integrations (the token never reaches the webview)
export const integrationCall = (provider: string, method: string, path: string, body: unknown) =>
  invoke<unknown>("integration_call", { provider, method, path, body });
export const integrationUpload = (args: {
  provider: string;
  url: string;
  fields: Record<string, string>;
  name: string;
  mime: string;
  data: string;
}) => invoke<string>("integration_upload", args);
/** Switched on, config complete and a token in the keychain. */
export const integrationStatus = (provider: string) => invoke<boolean>("integration_status", { provider });
export const integrationHasToken = (provider: string) => invoke<boolean>("integration_has_token", { provider });
/** Can the provider take its credentials from Claude Code, and does Claude Code have them. */
export const integrationMcp = (provider: string) =>
  invoke<{ supported: boolean; found: boolean }>("integration_mcp", { provider });
/** A secret into the keychain under `account` ("token" when left out); "" removes the token. */
export const integrationToken = (provider: string, token: string, account?: string) =>
  invoke("integration_token", account === undefined ? { provider, token } : { provider, token, account });
export const integrationImport = (provider: string) =>
  invoke<Record<string, string>>("integration_import", { provider });

// ---------- agent access to extensions (the vault's .relay/config.json)
export const actionConfig = () => invoke<ActionConfig>("action_config");
export const setActionConfig = (ext: string, entry: ActionEntry) =>
  invoke<ActionConfig["config"]>("set_action_config", { ext, entry });

// ---------- the embedded terminals (src-tauri/src/pty.rs) and the scratch notes (scratch.rs)
/** A shell in the project's vault folder. `onData` gets its output bytes, `onExit` its exit code; resolves with the
 *  shell's id. */
export const ptySpawn = (
  project: string,
  cols: number,
  rows: number,
  onData: (bytes: Uint8Array) => void,
  onExit: (code: number) => void,
) => {
  const channel = new Channel<ArrayBuffer | number>();
  channel.onmessage = msg => (msg instanceof ArrayBuffer ? onData(new Uint8Array(msg)) : onExit(msg));
  return invoke<number>("pty_spawn", { project, cols, rows, onData: channel });
};
export const ptyWrite = (id: number, data: string) => invoke("pty_write", { id, data });
export const ptyResize = (id: number, cols: number, rows: number) => invoke("pty_resize", { id, cols, rows });
export const ptyKill = (id: number) => invoke("pty_kill", { id });
export type ScratchFile = { id: string; text: string; modified: number };
export const scratchList = (project: string) => invoke<ScratchFile[]>("scratch_list", { project });
/** Writes the note, `id` null for a new one; resolves with its id. */
export const scratchSave = (project: string, id: string | null, text: string) =>
  invoke<string>("scratch_save", { project, id, text });
export const scratchDelete = (project: string, id: string) => invoke("scratch_delete", { project, id });

// ---------- events from the backend
/** One normalised event of an agent process. */
export const onAgent = (handler: (key: string, event: AgentEvent, provider: string) => void) =>
  listen<{ project: string; provider: string; event: AgentEvent }>("agent", e =>
    handler(e.payload.project, e.payload.event, e.payload.provider),
  );
/** A notification banner was clicked: open that conversation. */
export const onOpenChat = (handler: (key: string) => void) => listen<string>("open-chat", e => handler(e.payload));
/** A link clicked inside a mail's sandboxed frame. */
export const onMailLink = (handler: (url: string) => void) => listen<string>("mail-link", e => handler(e.payload));
/** The settings window saved. */
export const onSettingsChanged = (handler: (settings: Settings) => void) =>
  listen<Settings>("settings-changed", e => handler(e.payload));
/** An item of the app menu (new-general, new-project, close-chat). */
export const onMenu = (handler: (item: string) => void) => listen<string>("menu", e => handler(e.payload));
export const onIconsChanged = (handler: () => void) => listen("icons-changed", () => handler());
/** The GitHub repos of a project changed (the settings, or a link answered in a conversation). */
export const onReposChanged = (handler: () => void) => listen("repos-changed", () => handler());
/** A conversation committed to a repo no project has. */
export const onRepoUnlinked = (handler: (key: string, repo: string) => void) =>
  listen<{ key: string; repo: string }>("repo-unlinked", e => handler(e.payload.key, e.payload.repo));
export const onRemindersChanged = (handler: () => void) => listen("reminders-changed", () => handler());
/** The relay:// links that launched the app: they arrive before anything listens. */
export const launchLinks = async () => (await getCurrent()) ?? [];
/** Every relay:// link opened while the app runs. */
export const onDeepLink = (handler: (url: string) => void) => onOpenUrl(urls => urls.forEach(handler));
