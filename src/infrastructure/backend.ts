import { Channel, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import type { AgentEvent, AgentsStatus, Decision } from "../domain/agents/types";
import type { SlashCommand } from "../domain/conversations/commands";
import type { Related } from "../domain/related/rules";
import type { RepoChanges } from "../domain/conversations/changes";
import type { AgentUpdate, UpdateProgress, UpdatesStatus } from "../domain/settings/updates";
import type {
  AgentSession,
  Pending,
  Retry,
  RetryEvent,
  SessionOf,
  Sub,
  Transcript,
} from "../domain/conversations/types";
import type {
  ActionConfig,
  VaultSync,
  ActionEntry,
  DeviceCode,
  Machine,
  MachineChoice,
  MachineGithub,
  MachineRepo,
  MachineStatus,
  MirrorProgress,
  MirrorStatus,
  ServerSetup,
  HostStatus,
  PhonePairing,
  MailAcct,
  Settings,
} from "../domain/settings/types";
import type {
  ExtraVault,
  IconKind,
  ProjectIcon,
  Snapshot,
  VaultMap,
  VaultNotes,
  VaultStatus,
} from "../domain/workspace/types";
import type { Mail, MailBody } from "../domain/mail/types";
import type { Meetings } from "../domain/calendar/types";
import type { PrDetail, PRs } from "../domain/pull-requests/types";
import type { BrainGraph, BrainNote, BrainRoot, BrainStatus, SearchHit, Touch } from "../domain/brain/types";
import type { AllTokens, ProvLimits } from "../domain/usage/types";
import type { OrchEvent, Worker } from "../domain/orchestrator/types";
import type { PrStatus, Ticket } from "../domain/pipeline/types";
import type { SpeechModelInfo } from "../domain/settings/voice";
import type { Recording } from "../domain/calendar/rules";
import type { Plugin, PluginTest, PluginViewInfo, ToolResult } from "../domain/plugins/types";

// Every Tauri command the webview calls and every event it listens to, one typed function each (src-tauri/src/lib.rs
// has the other half). Nothing else in the app calls `invoke` or `listen`. The arguments are the backend's, unchanged.

/** An event the backend sends to one Relay window (the menu, a banner's click): a plain `listen` hears what is sent to
 *  any window, this only what is sent to this one or to all (src-tauri/src/windows.rs). */
const listenHere: typeof listen = (event, handler) => getCurrentWebview().listen(event, handler);

// ---------- files attached by their path (src-tauri/src/files.rs)
/** The files picked in the open dialog, as paths. */
export const pickFiles = () => invoke<string[]>("pick_files");
/** A picture at a path as [media type, base64], to send it inline. */
export const readImage = (path: string) => invoke<[string, string]>("read_image", { path });
/** An attached file in its default app, or shown in Finder (`reveal`). Rejects when it is gone. */
export const openFile = (path: string, reveal: boolean) => invoke("open_file", { path, reveal });
/** The files copied in Finder, as paths: empty when the clipboard holds none. */
export const pastedFiles = () => invoke<string[]>("pasted_files");
/** Text on the clipboard, written by the app (the webview's clipboard API is refused now and then). */
export const copyText = (text: string) => invoke("copy_text", { text });
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
export const openSettingsWindow = (tab?: string) => invoke("open_settings_window", tab ? { tab } : {});
/** Relay's updates (src-tauri/src/updater.rs): the last check's answer, a new check, and installing what it found
 *  (restarts the app). */
export const updatesStatus = () => invoke<UpdatesStatus>("updates_status");
export const updatesCheck = () => invoke<UpdatesStatus>("updates_check");
export const updatesInstall = () => invoke("updates_install");
/** The agent CLIs' installed and latest versions, and updating one. */
export const agentUpdates = () => invoke<AgentUpdate[]>("agent_updates");
export const agentUpdate = (id: string) => invoke("agent_update", { id });
/** A web or mail link in the default browser or mail app: a webview window cannot open them itself. */
export const openUrl = (url: string) => invoke("plugin:opener|open_url", { url });
/** A banner; a click opens `key` (src-tauri/src/notify.rs). A newer banner replaces the one in its `slot`, the key
 *  when left out. */
export const notify = (key: string, title: string, body: string, slot?: string) =>
  invoke("notify", { key, title, body, ...(slot ? { slot } : {}) });

// ---------- the vault
export const vaultStatus = () => invoke<VaultStatus>("vault_status");
export const extraVaultsStatus = () => invoke<ExtraVault[]>("extra_vaults_status");
export const snapshot = () => invoke<Snapshot>("snapshot");
export const vaultNotes = () => invoke<VaultNotes>("vault_notes");
export const readNote = (target: string) => invoke<unknown>("read_note", { target });
export const pickFolder = () => invoke<string | null>("pick_folder");
export const pickPath = (folder: boolean, start: string) => invoke<string | null>("pick_path", { folder, start });
export const detectVault = (path: string) => invoke<VaultStatus>("detect_vault", { path });
export const checkVault = (path: string, map: VaultMap) => invoke<VaultStatus>("check_vault", { path, map });
/** The starter vault copied to ~/Relay (kept when it is already there), with its status. */
export const createDefaultVault = () => invoke<VaultStatus>("create_default_vault");
export const projectIcons = () => invoke<Record<string, ProjectIcon>>("project_icons");
export const setProjectIcon = (project: string, kind: IconKind, value: string) =>
  invoke("set_project_icon", { project, kind, value });
export const favicons = (projects: { name: string; aliases: string[] }[]) =>
  invoke<Record<string, { site: string; data: string | null }>>("favicons", { projects });
export const findIconSites = (projects: { name: string; context: string; summary: string }[]) =>
  invoke<Record<string, string>>("find_icon_sites", { projects });
/** Write what a closed conversation leaves for the vault, straight in (lib.rs capture_vault). */
export const captureVault = (key: string) => invoke<void>("capture_vault", { key });
export const projectRepos = () => invoke<Record<string, string[]>>("project_repos");
export const setProjectRepos = (project: string, repos: string[]) => invoke("set_project_repos", { project, repos });
/** The Design drawer's native claude.ai webview (design.rs), placed by the drawer's bounds in logical px. */
export const designShow = (url: string, r: DOMRect) =>
  invoke("design_show", { url, x: r.x, y: r.y, w: r.width, h: r.height });
export const designBounds = (r: DOMRect) => invoke("design_bounds", { x: r.x, y: r.y, w: r.width, h: r.height });
export const designHide = () => invoke("design_hide");
export const designLink = (project: string) => invoke<string>("design_link", { project });
export const setDesignLink = (project: string, url: string) => invoke("set_design_link", { project, url });
/** An agent's design tool (relay-design, design.rs) wants the Design drawer of a conversation's project open, showing
 *  `start` while the project has no link; `designOpened` answers once it is, "" for a conversation without a project. */
export const onDesignOpen = (handler: (open: { id: number; key: string; start: string | null }) => void) =>
  listenHere<{ id: number; key: string; start: string | null }>("design-open", e => handler(e.payload));
export const designOpened = (id: number, project: string) => invoke("design_opened", { id, project });
/** design_create saved the link of a project's new design. */
export const onDesignLink = (handler: (link: { project: string; url: string }) => void) =>
  listen<{ project: string; url: string }>("design-link", e => handler(e.payload));
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
  machine: string | null; // where a new conversation runs: "" this Mac, a machine id, null the default
  /** The project to tell the agent about; the backend puts the project line in front of `text`. */
  told: string | null;
  /** The conversation's project, sent on every message so the team brain files what it learns under it. */
  about: string | null;
  context: string | null;
};
export const send = (args: SendArgs) => invoke("send", args);
export const stop = (project: string) => invoke("stop", { project });
/** Removes the git worktrees a conversation made; the ones with work git would lose stay. */
export const dropWorktrees = (project: string) =>
  invoke<{ removed: number; kept: number }>("drop_worktrees", { project });
/** What a conversation changed, per repo, from git: the repos of the paths it wrote and the worktrees it made. */
export const conversationChanges = (key: string, paths: string[]) =>
  invoke<RepoChanges[]>("conversation_changes", { key, paths });
export const answer = (id: string, decision: Decision) => invoke("answer", { id, decision });
/** A background or terminal session: hide is the app's own, stop and attach (open in iTerm) go to the backend. */
export const backgroundSession = (action: "stop" | "attach", id: string) => invoke("bg", { action, id });
export const openTerminal = (project: string, session: string | null, name: string) =>
  invoke("open_terminal", { project, session, name });
export const aiTitle = (text: string, provider: string) => invoke<string>("ai_title", { text, provider });
export const agentHistory = (key: string, id: string, from: number) =>
  invoke<Transcript<AgentEvent>>("agent_history", { key, id, from });
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
/** When the user wrote in each of these Claude Code sessions on a day (yyyy-mm-dd, local), in ms. */
export const activity = (date: string, sessions: string[]) =>
  invoke<Record<string, number[]>>("activity", { date, sessions });

// ---------- the orchestrator (src-tauri/src/orch.rs): its coordinator talks through `send` like any conversation
/** Every worker the coordinator started, also the ones made while no page listened. */
export const orchWorkers = () => invoke<Worker[]>("orch_workers");
/** The conversations waiting for a provider limit to reset (src-tauri/src/retry.rs). */
export const retries = () => invoke<Retry[]>("retries");
export const retryCancel = (key: string) => invoke("retry_cancel", { key });
/** Stops a worker; the backend reports its new state as an `orch` event. */
export const orchStop = (key: string) => invoke<boolean>("orch_stop", { key });
/** The board pipeline (orch.rs): a worker on a ticket, a follow-up to one, its PR as gh reads it, and what the pipeline
 *  did on the board for it. */
export const orchDispatchTicket = (a: {
  title: string;
  task: string;
  project: string;
  repo: string;
  base: string;
  ticket: Ticket;
  validate: { checks: string; review: string; rounds: number };
  plan: boolean;
  skill: string;
}) => invoke<Worker>("orch_dispatch_ticket", a);
export const orchMessage = (key: string, text: string) => invoke<void>("orch_message", { key, text });
export const orchAnswer = (key: string, answer: string) => invoke<Worker | null>("orch_answer", { key, answer });
export const orchAskReport = (key: string) => invoke<void>("orch_ask_report", { key });
export const orchRestart = (key: string) => invoke<Worker>("orch_restart", { key });
export const orchPr = (key: string) => invoke<PrStatus>("orch_pr", { key });
export const orchBoard = (key: string, mark: string) => invoke<Worker | null>("orch_board", { key, mark });

// ---------- work machines (relay-server in the LAN)
/** The machine each conversation runs on, by conversation key. */
export const chatMachines = () => invoke<Record<string, { machine: string; id: string; cwd: string }>>("chat_machines");
/** Moves a conversation, between two turns, to another place: "" this Mac, or a machine id. Back to this Mac, a repo
 *  of the project it is `about` with work not pushed on the machine refuses it (an error starting with "repo-work:"),
 *  until `choice` says to push that work first ("push") or to move anyway ("move"). */
export const moveConversation = (
  key: string,
  to: string,
  mail: boolean,
  about: string | null,
  choice: "push" | "move" | null = null,
) => invoke("move_conversation", { key, to, mail, about, choice });
/** Every paired machine as the backend last heard it, no network: for the composer's pick. */
export const machinesList = () => invoke<MachineChoice[]>("machines_list");
/** Pairs with the line `relay-server pair` printed; the backend saves the machine and emits settings-changed. */
export const machinePair = (line: string, name: string) => invoke<Machine>("machine_pair", { line, name });
export const machineStatus = (id: string) => invoke<MachineStatus>("machine_status", { id });
/** A one-time pairing for a phone of this Mac on a machine, valid 10 minutes: the line (with the mirror's key) and a QR (SVG). */
export const machinePairPhone = (id: string) => invoke<PhonePairing>("machine_pair_phone", { id });
/** `/share-phone`: the conversation (and its title for the phone's list) shared with this Mac's phone, or not any more.
 *  Refused for a conversation about a mail, one on a machine and before a phone is added. */
export const phoneShare = (key: string, on: boolean, title: string, mail: boolean) =>
  invoke("phone_share", { key, on, title, mail });
/** The conversations shared with the phone. */
export const phoneShared = () => invoke<string[]>("phone_shared");
/** This Relay's version and the relay-server image that speaks its protocol, for setting up a machine. */
export const serverSetup = () => invoke<ServerSetup>("server_setup");
/** This Mac as a work machine: whether its LaunchAgent and server run. */
export const hostStatus = () => invoke<HostStatus>("host_status");
/** Turns this Mac as a machine on or off, gives the new status. */
export const hostSet = (on: boolean) => invoke<HostStatus>("host_set", { on });
/** A one-time pairing line for another Mac, valid 10 minutes. */
export const hostPair = () => invoke<string>("host_pair");
export const machineForget = (id: string) => invoke("machine_forget", { id });
export const machineUpdate = (id: string) => invoke<{ version: string }>("machine_update", { id });
/** Where new conversations run without a pick ("" this Mac); the backend emits settings-changed. */
export const setMachinesDefault = (id: string) => invoke("set_machines_default", { id });
/** The vault folders that stay on this Mac, out of a machine's mirror. */
export const setMachineMirror = (id: string, exclude: string[]) => invoke("set_machine_mirror", { id, exclude });
/** The last sync round of a machine's mirror, null before the first. */
export const mirrorStatus = (id: string) => invoke<MirrorStatus | null>("mirror_status", { id });
/** Where the running round of a machine's mirror is, null between rounds. */
export const mirrorProgress = (id: string) => invoke<MirrorProgress | null>("mirror_progress", { id });
/** GitHub on a machine: connected or not, and as whom. */
export const machineGithub = (id: string) => invoke<MachineGithub>("machine_github", { id });
/** Starts connecting a machine to GitHub: the code to type there. */
export const machineGithubConnect = (id: string) => invoke<DeviceCode>("machine_github_connect", { id });
/** Where connecting stands: `pending` until the code is typed. */
export const machineGithubPoll = (id: string) => invoke<MachineGithub>("machine_github_poll", { id });
export const machineGithubDisconnect = (id: string) => invoke("machine_github_disconnect", { id });
/** The repos on a machine with what is not pushed. */
export const machineRepos = (id: string) => invoke<MachineRepo[]>("machine_repos", { id });
export const machineRepoPush = (id: string, name: string) => invoke<MachineRepo>("machine_repo_push", { id, name });
/** The work in a repo there on `relay/<machine>`, fetched into this Mac's checkout of it: that branch and folder. */
export const machineRepoToMac = (id: string, name: string) =>
  invoke<{ branch: string; dir: string }>("machine_repo_to_mac", { id, name });
/** Before a conversation's first start on a machine: its project's repo cloned or fetched there (may take minutes).
 *  Null on a machine from before repos there. */
export const machineRepoEnsure = (id: string, key: string, repo: string) =>
  invoke<MachineRepo | null>("machine_repo_ensure", { id, key, repo });

// ---------- usage
export const usageLimits = () => invoke<ProvLimits[]>("usage_limits");
export const usageTokens = (period: { today: number; week: number }) => invoke<AllTokens>("usage_tokens", period);

// ---------- GitHub
export const githubPrs = () => invoke<PRs>("github_prs");
export const githubPr = (repo: string, number: number) => invoke<PrDetail>("github_pr", { repo, number });
/** A PR's files with their patch, for the review screen. */
export const githubPrFiles = (repo: string, number: number) =>
  invoke<{ path: string; status: string; additions: number; deletions: number; patch?: string | null }[]>(
    "github_pr_files",
    { repo, number },
  );
/** Post a review on GitHub: only after the user confirmed it. */
export const githubPrReview = (
  repo: string,
  number: number,
  event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
  body: string,
  comments: { path: string; line: number; side: "LEFT" | "RIGHT"; body: string }[],
) => invoke<void>("github_pr_review", { repo, number, event, body, comments });
export const githubStatus = () => invoke<string>("github_status");

// ---------- Commonwealth, the team brain
export const commonwealthStatus = () => invoke<BrainStatus>("commonwealth_status");
export const commonwealthInstall = () => invoke<void>("commonwealth_install");
export const commonwealthJoin = (remote: string) => invoke<string>("commonwealth_join", { remote });
export const commonwealthNotes = () => invoke<BrainNote[]>("commonwealth_notes");
export const commonwealthAct = (brain: string, verb: "promote" | "reject", ids: string[]) =>
  invoke<void>("commonwealth_act", { brain, verb, ids });
// ---------- the Brain view: the vault and the brains, browsed, searched and drawn
export const brainRoots = () => invoke<BrainRoot[]>("brain_roots");
export const brainGraph = (root: string) => invoke<BrainGraph>("brain_graph", { root });
export const brainSearch = (root: string, query: string) => invoke<SearchHit[]>("brain_search", { root, query });
export const brainNote = (root: string, path: string) =>
  invoke<{ path: string; text: string }>("brain_note", { root, path });
export const brainTouches = (days: number) => invoke<Touch[]>("brain_touches", { days });

// ---------- mail
export const mailList = (account: string, page: number) => invoke<Mail[]>("mail_list", { account, page });
export const mailRead = (account: string, id: string) => invoke<MailBody>("mail_read", { account, id });
export const mailSeen = (account: string, id: string, seen: boolean) => invoke("mail_seen", { account, id, seen });
/** Archive (`trash` false) or move to Trash, the mails the user picked. The backend refuses with the experimental mail flag off. */
/** Today's mail detail: a mail's thread, its reply headers (`read` with `headers`), or a draft saved in Drafts. */
export const mailTool = <T = unknown>(
  name: "thread" | "read" | "save_draft" | "attachment",
  args: Record<string, unknown>,
) => invoke<T>("mail_tool", { name, args });
/** A text the agent writes from `text` following `system`, with no tools (a reply draft, a rewrite). */
export const aiWrite = (system: string, text: string, provider?: string) =>
  invoke<string>("ai_write", { system, text, provider });
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
/** A picture's preview from a URL the provider's `thumb` allows, fetched without secrets, as a data URL. */
export const integrationThumb = (provider: string, url: string) =>
  invoke<string>("integration_thumb", { provider, url });
/** A ticket's pictures ([name, url]) saved on this Mac for an agent, with the viewer window's login; the paths that came. */
export const ticketPictures = (provider: string, files: [string, string][]) =>
  invoke<string[]>("ticket_pictures", { provider, files });
/** A picture's original in Relay's viewer window (the tracker's login once, then the picture). */
export const openViewer = (provider: string, url: string, name: string) =>
  invoke<void>("open_viewer", { provider, url, name });
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

// ---------- plugins: MCP servers and their views (src-tauri/src/plugins.rs)
/** Which of each plugin's secrets are in the keychain: `{ id: { NAME: true } }`. */
export const pluginsList = () => invoke<Record<string, Record<string, boolean>>>("plugins_list");
/** A secret of a plugin into the keychain; "" removes it. */
export const pluginSecret = (id: string, name: string, value: string) => invoke("plugin_secret", { id, name, value });
/** Before a plugin leaves the settings: stops its server and deletes its secrets. */
export const pluginForget = (id: string) => invoke("plugin_forget", { id });
/** Starts the plugin afresh and lists what it offers. */
export const pluginTest = (id: string) => invoke<PluginTest>("plugin_test", { id });
/** Reads the plugin's view and has it served: the URL for the sandboxed frame. */
export const pluginView = (id: string, uri?: string) =>
  invoke<PluginViewInfo>("plugin_view", uri ? { id, uri } : { id });
/** A tool call from the plugin's view; the backend refuses a tool that is not allowed. */
export const pluginCall = (id: string, tool: string, args: Record<string, unknown>) =>
  invoke<ToolResult>("plugin_call", { id, tool, args });
/** The names of Claude Code's MCP servers that can become plugins, and importing one. */
export const pluginImportList = () => invoke<string[]>("plugin_import_list");
export const pluginImport = (name: string) => invoke<Plugin>("plugin_import", { name });

// ---------- agent access to extensions (the vault's .relay/config.json)
export const actionConfig = () => invoke<ActionConfig>("action_config");
export const setActionConfig = (ext: string, entry: ActionEntry) =>
  invoke<ActionConfig["config"]>("set_action_config", { ext, entry });

// ---------- the vault's git backup (the vault's .relay/config.json `sync`, src-tauri/src/vaultsync.rs)
export const vaultSync = () => invoke<VaultSync>("vault_sync");
export const setVaultSync = (remote: string, on: boolean, minutes: number) =>
  invoke<VaultSync>("set_vault_sync", { remote, on, minutes });
/** A sync round ended. */
export const onVaultSync = (handler: (last: NonNullable<VaultSync["last"]>) => void) =>
  listen<NonNullable<VaultSync["last"]>>("vault-sync", e => handler(e.payload));

// ---------- the embedded terminals (src-tauri/src/pty.rs) and the scratch notes (scratch.rs)
/** A shell in the project's vault folder, first continuing the conversation `chat` when given. `onData` gets its
 *  output bytes, `onExit` its exit code; resolves with the shell's id. */
export const ptySpawn = (
  project: string,
  cols: number,
  rows: number,
  onData: (bytes: Uint8Array) => void,
  onExit: (code: number) => void,
  chat?: { key: string; name: string },
) => {
  const channel = new Channel<ArrayBuffer | number>();
  channel.onmessage = msg => (msg instanceof ArrayBuffer ? onData(new Uint8Array(msg)) : onExit(msg));
  return invoke<number>("pty_spawn", { project, chat: chat?.key, name: chat?.name, cols, rows, onData: channel });
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

// ---------- dictation in the composer (src-tauri/src/dictation.rs)
/** Every speech model Settings › Voice offers, with whether it is on this Mac. */
export const dictationModels = () => invoke<SpeechModelInfo[]>("dictation_models");
/** Whether the model picked in Settings › Voice is on this Mac. */
export const dictationModel = () => invoke<boolean>("dictation_model");
/** Downloads a speech model (`id`, or the picked one), `onProgress` from 0 to 1. Rejects with "busy" while it already
 *  downloads. */
export const dictationDownload = (id: string | null, onProgress: (done: number) => void) => {
  const channel = new Channel<number>();
  channel.onmessage = onProgress;
  return invoke("dictation_download", { id, onProgress: channel });
};
export const dictationDelete = (id: string) => invoke("dictation_delete", { id });
/** Whether Relay may send ⌘V to other apps (Accessibility), for dictating into any app (src-tauri/src/anywhere.rs). */
export const dictationAccess = () => invoke<boolean>("dictation_access");
/** The global dictation shortcuts step aside while Settings › Voice records a new one (macOS would swallow it). */
export const dictationPauseShortcuts = (paused: boolean) => invoke("dictation_pause_shortcuts", { paused });
/** What was said with the new-conversation shortcut, from any app (src-tauri/src/anywhere.rs). */
export const onDictatedChat = (handler: (text: string) => void) =>
  listenHere<string>("dictated-chat", e => handler(e.payload));
/** Shows macOS's Accessibility dialog; resolves with whether it is already allowed. */
export const dictationAskAccess = () => invoke<boolean>("dictation_ask_access");
/** What macOS lets Relay do, per permission: "ok", "missing", "ask" (not asked yet) or null when it cannot be told
 *  (src-tauri/src/permissions.rs). */
export const permissions = () => invoke<Record<string, "ok" | "missing" | "ask" | null>>("permissions");
/** Opens the pane of System Settings where one permission is switched. */
export const permissionsOpen = (which: string) => invoke("permissions_open", { which });
/** What the dictation pill shows, sent by the backend to its window. */
export type PillState = {
  phase: "hidden" | "recording" | "transcribing" | "copied" | "error";
  level?: number;
  error?: string;
};
export const onPill = (handler: (state: PillState) => void) => listen<PillState>("pill", e => handler(e.payload));
/** Starts recording the microphone, its level (0..1) on `onLevel`. Rejects with "model" while the model is missing. */
export const dictationStart = (onLevel: (level: number) => void) => {
  const channel = new Channel<number>();
  channel.onmessage = onLevel;
  return invoke("dictation_start", { onLevel: channel });
};
/** Stops recording; resolves with the text, rejects with "silent" when the microphone gave nothing. */
export const dictationStop = () => invoke<string>("dictation_stop");
export const dictationCancel = () => invoke("dictation_cancel");

// ---------- recording a meeting (src-tauri/src/meeting.rs)
/** A quarter-second tick while recording: the seconds, and the levels (0..1) of `me` and, when tapped, `others`. */
export type RecordingTick = { secs: number; me?: number; others?: number };
/** Starts recording the microphone and, when macOS allows it, what the Mac plays (`system`, else `why` not). */
export const meetingRecordStart = (onTick: (tick: RecordingTick) => void) => {
  const channel = new Channel<RecordingTick>();
  channel.onmessage = onTick;
  return invoke<{ system: boolean; why: string | null }>("meeting_record_start", { onTick: channel });
};
/** Stops, then writes the audio and transcript into the vault, `onProgress` 0..1 while it transcribes. */
export const meetingRecordStop = (title: string, me: string, others: string, onProgress: (done: number) => void) => {
  const channel = new Channel<number>();
  channel.onmessage = onProgress;
  return invoke<Recording>("meeting_record_stop", { title, me, others, onProgress: channel });
};
/** Writes out the newest recording a failed stop kept, as `meetingRecordStop`. */
export const meetingRecordRetry = (title: string, me: string, others: string, onProgress: (done: number) => void) => {
  const channel = new Channel<number>();
  channel.onmessage = onProgress;
  return invoke<Recording>("meeting_record_retry", { title, me, others, onProgress: channel });
};
export const meetingRecordCancel = () => invoke("meeting_record_cancel");

// ---------- events from the backend
/** One normalised event of an agent process. */
export const onAgent = (handler: (key: string, event: AgentEvent, provider: string) => void) =>
  listen<{ project: string; provider: string; event: AgentEvent }>("agent", e =>
    handler(e.payload.project, e.payload.event, e.payload.provider),
  );
/** A worker made or changed, or a user turn Relay wrote into a conversation itself. */
export const onOrch = (handler: (event: OrchEvent) => void) => listen<OrchEvent>("orch", e => handler(e.payload));
/** The waiting retries changed, or one is due: send it. */
export const onRetry = (handler: (event: RetryEvent) => void) => listen<RetryEvent>("retry", e => handler(e.payload));
/** A notification banner was clicked: open that conversation. */
export const onOpenChat = (handler: (key: string) => void) => listenHere<string>("open-chat", e => handler(e.payload));
/** A link clicked inside a mail's sandboxed frame. */
export const onMailLink = (handler: (url: string) => void) => listen<string>("mail-link", e => handler(e.payload));
/** The settings window saved. */
export const onSettingsChanged = (handler: (settings: Settings) => void) =>
  listen<Settings>("settings-changed", e => handler(e.payload));
/** A check for Relay updates finished (the daily one too). */
export const onUpdates = (handler: (status: UpdatesStatus) => void) =>
  listen<UpdatesStatus>("updates", e => handler(e.payload));
export const onUpdateProgress = (handler: (progress: UpdateProgress) => void) =>
  listen<UpdateProgress>("update-progress", e => handler(e.payload));
/** The open settings window is asked to show a page (Relay › Check for Updates). */
export const onSettingsGo = (handler: (tab: string) => void) => listen<string>("settings-go", e => handler(e.payload));
/** An item of the app menu (new-project, new-general, reopen-chat, close-chat). */
export const onMenu = (handler: (item: string) => void) => listenHere<string>("menu", e => handler(e.payload));
export const onIconsChanged = (handler: () => void) => listen("icons-changed", () => handler());
/** The GitHub repos of a project changed (the settings, or a link answered in a conversation). */
export const onReposChanged = (handler: () => void) => listen("repos-changed", () => handler());
/** A conversation committed to a repo no project has. */
export const onRepoUnlinked = (handler: (key: string, repo: string) => void) =>
  listen<{ key: string; repo: string }>("repo-unlinked", e => handler(e.payload.key, e.payload.repo));
export const onRemindersChanged = (handler: () => void) => listen("reminders-changed", () => handler());
/** A conversation this Mac's phone started on a work machine, now this Mac's too (its first thing said, when known). */
export const onRemoteChat = (handler: (chat: { key: string; title: string | null; provider: string }) => void) =>
  listen<{ key: string; title: string | null; provider: string }>("remote-chat", e => handler(e.payload));
/** The relay:// links that launched the app: they arrive before anything listens. */
export const launchLinks = async () => (await getCurrent()) ?? [];
/** Every relay:// link opened while the app runs. */
export const onDeepLink = (handler: (url: string) => void) => onOpenUrl(urls => urls.forEach(handler));

// ---------- related notes: the vault's full-text index (src-tauri/src/related.rs)
export const relatedNotes = (text: string) => invoke<Related[]>("related_notes", { text });
