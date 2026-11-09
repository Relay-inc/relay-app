// The Tauri backend, mocked at the IPC boundary: every command the frontend invokes, the event plugin, the window.
// Loaded as the first script of index.html and settings.html (harness/vite.config.ts), before the app's entry.
// Nothing here knows the app's internals: it answers commands with the shapes src-tauri/src/*.rs returns and emits the
// events the backend emits. Query: ?fixture=default|dark|graphite|icons|onboarding|calendar|accounts|mailexp|machines|phone|mirror|nomirror|orch|plugins|plugins-dark|shared|shared-invite|shared-member|shared-member-dark|shared-keeper|shared-people|shared-readers|shared-reader|shared-live|shared-live-dark|shared-nohistory|shared-org, ?sel=<selection key> (what the window
// opens on), ?link=<relay:// url> (the deep link the app was launched with), ?window=<label> (main-2: a window Cmd-N opened).
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { NOW, pngBase64 } from "./fixtures/util";
import * as embeds from "./fixtures/embeds";
import * as vault from "./fixtures/vault";
import * as conv from "./fixtures/conversations";
import * as integ from "./fixtures/integrations";
import * as orch from "./fixtures/orchestrator";
import * as graph from "./fixtures/graph";
import * as git from "./fixtures/git";
import * as files from "./fixtures/files";
import * as kb from "./fixtures/kb";
import * as inbox from "./fixtures/inbox";
import * as coll from "./fixtures/collections";
import * as views from "./fixtures/views";
import * as Y from "yjs";
import { SHIPPED } from "../src/domain/types/registry";
import { vaultChoices } from "../src/domain/conversations/rules";
// the example plugin's real view: the harness serves it from a blob, where the app has the relay-plugin:// scheme
import diceView from "../packages/plugin-example/view.html?raw";

type Args = Record<string, any>;
type Call = { cmd: string; args: Args; at: number };

const query = new URLSearchParams(location.search);
const fixture = query.get("fixture") || "default";
const onboarding = fixture === "onboarding";
const isSettingsWindow = location.pathname.endsWith("settings.html");

// ---------- the persisted state a returning user has: the conversation list, the open view, the board picked
// (localStorage is the app's own store; it is reset on every load so each run starts the same)
function seedStorage() {
  const prefsTab = localStorage.getItem("prefsTab");
  localStorage.clear();
  if (isSettingsWindow && prefsTab) localStorage.setItem("prefsTab", prefsTab);
  if (onboarding) return;
  const chats = Object.fromEntries(conv.conversations.map(c => [c.key, { ...c }]));
  localStorage.setItem("chats", JSON.stringify(chats));
  localStorage.setItem("sel", JSON.stringify(query.get("sel") || "__wait"));
  localStorage.setItem("pvProject", "p1");
  localStorage.setItem("pvBoard", "f1");
  if (fixture === "linear") {
    localStorage.setItem("linearProject", integ.LINEAR_TEAM);
    localStorage.setItem("linearBoard", `cycle_${integ.LINEAR_TEAM}`);
  }
}
seedStorage();

// the main window is transparent over the macOS sidebar material (tauri.conf.json windowEffects); a browser has no
// material behind the page, so the page root gets the sidebar token as its stand-in
const material = document.createElement("style");
material.textContent = "html { background: var(--sidebar); }";
document.head.append(material);

// ---------- mutable backend state
let settings = vault.settings(fixture);
// orch-plain: the orchestrator with the workers' crabs switched off (Settings › General)
if (fixture === "orch-plain") settings = { ...settings, workerCrabs: false };
// Files is experimental and off in the app until switched on; the harness shows it on, except for `files-off`
settings = { ...settings, experimental: { files: fixture !== "files-off" } };
// shared-invite: the same, opened by an invite link (shared_vault_pending_invite); shared-member: a Mac that joined
// the vault with a link, its server not one of its machines; shared-keeper: that member, made admin on the server,
// which Members (shared_vault_info) finds: the backend then keeps the server under Machines
// shared-member-dark: shared-member in the dark theme (the vault check's member view, issue 425)
const member = fixture === "shared-member" || fixture === "shared-member-dark" || fixture === "shared-keeper";
// shared-people: the member list has people, one with two Macs (vault.sharedPeople). shared-readers: the same, the
// Design laptop a reader. shared-reader: this Mac only reads the vault (vault.readerVaults), two changes in its folder
// left out of its rounds
const reader = fixture === "shared-reader";
const people = fixture === "shared-people" || fixture === "shared-readers";
// shared-rekey: someone left the vault, and the key change waits for a member whose Relay has no public key yet
// shared-live (-dark): "shared", and a page of the side vault is a shared document two mock peers edit (ticket 9)
const live = fixture === "shared-live" || fixture === "shared-live-dark";
// shared-nohistory: "shared", the workspace Northwind made without history (its member list's `nohistory`): its
// conflict copy names no Mac
const noHistory = fixture === "shared-nohistory";
// shared-org: "shared" on a full machine (not for workspaces only) whose server has an organisation, this Mac one of
// its admins: Organisation under the machine (docs/workspaces.md, Organisation), Northwind's policy Claude Code only
const org = fixture === "shared-org";
const shared =
  fixture === "shared" ||
  org ||
  noHistory ||
  fixture === "kb-shared" ||
  fixture === "shared-invite" ||
  fixture === "shared-rekey" ||
  fixture === "shared-unlisted" ||
  people ||
  reader ||
  member ||
  live;
if (shared)
  settings = {
    ...settings,
    extraVaults: [vault.TEAM_VAULT],
    machines:
      member || reader
        ? []
        : org
          ? vault.hubMachines.map(m => ({ ...m, sharedOnly: false }))
          : structuredClone(vault.hubMachines),
    sharedVaults: structuredClone(reader ? vault.readerVaults : member ? vault.memberVaults : vault.sharedVaults),
  };
// buddy: Buddy switched on, the first project linked to a Buddy project (fixtures/integrations buddy)
if (fixture === "buddy")
  settings = {
    ...settings,
    integrations: { ...settings.integrations, buddy: { on: true, host: "api.eu.buddy.works" } },
    buddy: { [vault.projectNames[0]]: { workspace: "acme", project: "web-shop" } },
  };
// the Pages tab with its folders shown in every workspace, as the views from before issue 420 expect; ?typed=1 opens
// on the tree by type, the app's default (a fresh vault)
if (!query.get("typed") && !onboarding)
  localStorage.setItem(
    "pagesFiles",
    JSON.stringify(Object.fromEntries(vaultChoices(settings).map(choice => [choice.folder, true]))),
  );
let vaultOk = !onboarding;
let pending = [...conv.pending];
const gitRepos = structuredClone(fixture === "git-long" ? git.longRepos : git.repos);
let reminders = [...vault.reminders];
let added = 0;
let actionConfig = integ.actionConfig();
// the vault's git backup, with a round three minutes ago
let vaultSync = {
  remote: "git@github.com:you/vault.git",
  on: true,
  minutes: 15,
  last: { at: Math.floor(Date.now() / 1000) - 180, ok: true, error: "", commit: "4e1f2a9" } as {
    at: number;
    ok: boolean;
    error: string;
    commit: string | null;
  } | null,
};
const movedMails = new Set<string>(); // "account:id" archived or deleted, gone from mail_list
const moved: Record<string, { name: string; vault: string }> = {}; // migrate_project: project -> its new key and vault
const phoneShared = new Set<string>(); // conversation keys shared with the phone (/share-phone)
// the shared vaults on a relay-server (fixture "shared"): the last rounds, and the one vault's members and open invites
let sharedStatus: Record<string, any> = shared ? vault.sharedStatus(Math.floor(Date.now() / 1000)) : {};
// this Mac is an admin of the first shared vault's member list: Settings › Machines offers the documents switch
for (const s of Object.values(sharedStatus).slice(0, 1)) {
  s.admin = true;
  s.admins = vault.sharedMembers.filter(m => m.role === "admin").map(m => m.fp);
  // shared-unlisted: Design laptop's Relay published its keys after the list was made, so the list lacks it
  s.listed = vault.sharedMembers
    .map(m => m.fp)
    .filter(fp => fixture !== "shared-unlisted" || fp !== vault.sharedMembers[2].fp);
  s.readers = fixture === "shared-readers" ? [vault.sharedMembers[2].fp] : reader ? [vault.SHARED_ME] : [];
  if (reader)
    Object.assign(s, {
      admin: false,
      admins: s.admins.filter((fp: string) => fp !== vault.SHARED_ME),
      reader: true,
      unsent: 2,
      pushed: 0,
      conflicts: [],
      held: [],
    });
}
if (org) for (const s of Object.values(sharedStatus)) s.policy = { providers: ["claude"], capture: false };
let orgState = structuredClone(vault.organisation);
// the server's SSO (src-tauri organisation.rs org_sso): none until Turn on
let orgSso: unknown = null;
// what an invite link's server asks to sign in with (src-tauri sso.rs): Google, required, on "shared-invite"
const inviteSso =
  fixture === "shared-invite"
    ? {
        issuer: "https://accounts.google.com",
        client: "123-example.apps.googleusercontent.com",
        domains: ["example.com"],
        required: true,
      }
    : null;
if (fixture === "shared-rekey")
  for (const s of Object.values(sharedStatus))
    Object.assign(s, {
      warnings: ["Someone left over an hour ago, and the key has not changed since."],
      rekeying: true,
      changed: [{ fp: vault.sharedMembers[1].fp, name: "Studio Mac" }],
      held: [],
      conflicts: [],
    });
let sharedMembers = structuredClone(vault.sharedMembers).map(m => ({
  ...m,
  role:
    (fixture === "shared-readers" && m.fp === vault.sharedMembers[2].fp) || (reader && m.fp === vault.SHARED_ME)
      ? "reader"
      : m.role,
}));
// the member list's people, as the server reads it and this Mac's round checked it (one list here)
let sharedPeople: { who: string; name: string; email: string; devices: string[] }[] = people
  ? structuredClone(vault.sharedPeople)
  : [];
for (const s of Object.values(sharedStatus).slice(0, 1)) s.people = sharedPeople;
if (noHistory)
  for (const s of Object.values(sharedStatus).slice(0, 1))
    Object.assign(s, {
      nohistory: true,
      conflicts: s.conflicts.map((c: string) => c.replace(/\(conflict [^)]*? (\d{4}-)/, "(conflict $1")),
    });
let sharedInvites = [{ id: "4d2e8a1b6c3f9e70", role: "member", expires: Math.floor(Date.now() / 1000) + 20 * 3600 }];
let pendingInvite: string | null = fixture === "shared-invite" ? vault.inviteLink("b81c0e5f2a7d3946") : null;
const hex = (n: number, seed: number) =>
  Array.from({ length: n }, (_, i) => ((i * 7 + seed) % 16).toString(16)).join("");
// the orchestrator's workers (fixture "orch"), changed by orch_stop
const orchOn = fixture === "orch" || fixture === "orch-plain" || fixture === "orch-empty" || fixture === "orch-closed";
// orch-empty: the orchestrator before its first task, no workers and an empty conversation
const orchEmpty = fixture === "orch-empty";
// orch-closed: an empty conversation, and workers the backend still reports whose conversations were all closed
const orchClosed = fixture === "orch-closed";
// plugins (fixture "plugins"): the secrets in the keychain, per plugin id; the tools the example server has
const pluginSecrets = new Map<string, Set<string>>(
  (settings.plugins ?? []).map((p: { id: string; secrets: string[] }) => [p.id, new Set(p.secrets)]),
);
// two views, so the plugin view shows its tabs; the harness serves the dice page for both
const diceViews = [
  { uri: "ui://relay-example/dice", name: "Dice" },
  { uri: "ui://relay-example/history", name: "History" },
];
const diceTools = [
  {
    name: "roll",
    description: "Roll a die with the given number of sides.",
    view: "ui://relay-example/dice",
    app: true,
  },
];
let workers = orchOn && !orchEmpty ? structuredClone(orch.workers) : [];

// ---------- the event plugin: listeners by event, emitted synchronously (a real Tauri event is one task per event)
const listeners = new Map<string, Set<number>>();
const internals = () => (window as any).__TAURI_INTERNALS__;
function emit(event: string, payload: unknown) {
  for (const id of [...(listeners.get(event) || [])]) internals().runCallback(id, { event, id, payload });
}
const emitAgent = (project: string, event: unknown, provider = "claude") => emit("agent", { project, provider, event });

// ---------- the embedded terminals: output goes to the Channel the frontend passed, as the backend does (raw bytes)
const PROMPT = "alex@mac ~/vault % ";
const ptys = new Map<number, { channel: number; index: number }>();
let ptyId = 0;
function ptyOut(id: number, text: string) {
  const pty = ptys.get(id);
  if (!pty) return;
  const bytes = new TextEncoder().encode(text);
  internals().runCallback(pty.channel, { index: pty.index++, message: bytes.buffer });
}
// ---------- voice (src-tauri/src/dictation.rs, meeting.rs, anywhere.rs): no microphone in a browser. A recording keeps
// the channel it was given, so `__harness.recordingTick` / `dictationLevel` can play its levels
const channelId = (c: unknown) =>
  typeof c === "object" && c ? (c as { id: number }).id : Number(String(c).split(":")[1]);
const sendTo = (channel: number | null, index: number, message: unknown) =>
  channel !== null && internals().runCallback(channel, { index, message });
let meetingTicks: { channel: number; index: number } | null = null;
let dictationLevels: { channel: number; index: number } | null = null;
const voiceModels = [
  { id: "parakeet-v3", mb: 456, langs: ["nl", "en", "de", "fr"], auto: true, installed: true, downloading: false },
  { id: "parakeet-v2", mb: 451, langs: ["en"], auto: true, installed: false, downloading: false },
  { id: "canary-1b-v2", mb: 691, langs: ["nl", "en", "de", "fr"], auto: false, installed: false, downloading: false },
  { id: "cohere", mb: 1708, langs: ["nl", "en", "de", "fr"], auto: true, installed: false, downloading: false },
  { id: "whisper-turbo", mb: 574, langs: ["nl", "en", "de", "fr"], auto: true, installed: false, downloading: false },
  { id: "moonshine-base", mb: 55, langs: ["en"], auto: true, installed: false, downloading: false },
];
const scratch = new Map<string, { id: string; text: string; modified: number }[]>();
// fixture kb-changes-inbox: the Inbox's notes (fixtures/inbox.ts)
const inboxOn = fixture.includes("inbox");
let scratchId = 0;
const NOW_S = Math.floor(NOW / 1000);
// the machine's GitHub and repos (fixture "github"), changed by Disconnect, Connect and Push
let github = structuredClone(vault.machineGit.github);
const machineRepos = structuredClone(vault.machineGit.repos);

// ---------- commands
const thumb = `data:image/png;base64,${pngBase64(100, 100, "#dfe7f7", "#2f6fdb")}`;
const calls: Call[] = [];
const unmocked = new Set<string>();
const sidKeys = () =>
  Object.fromEntries(conv.conversations.map(c => [c.key, { provider: c.provider, sid: conv.sidOf(c.key) }]));
const terminalAgents = () => [
  ...vault.terminalSessions.map((s, i) => ({
    id: `term-${i + 1}`,
    sessionId: s.sessionId,
    provider: "claude",
    kind: "interactive",
    status: i === 0 ? "busy" : "idle",
    name: s.name,
    startedAt: s.last_at,
  })),
  vault.backgroundBlocked,
];

// what the board pipeline did (fixture "pipeline"): its orch_* calls and its writes to Productive, in order
const pipelineCalls: { cmd: string; args: Args }[] = [];
// every pipeline PR as gh would read it, set with __harness.setPr
let prStatus: Record<string, unknown> = { state: "OPEN", reviewDecision: null, reviews: [], comments: [], inline: [] };
function handle(cmd: string, a: Args): unknown {
  if ((cmd.startsWith("orch_") && cmd !== "orch_workers") || (cmd === "integration_call" && a.method !== "GET"))
    pipelineCalls.push({ cmd, args: structuredClone(a) });
  switch (cmd) {
    // event plugin
    case "plugin:event|listen": {
      (listeners.get(a.event) ?? listeners.set(a.event, new Set()).get(a.event)!).add(a.handler);
      return a.handler;
    }
    case "plugin:event|unlisten":
      listeners.get(a.event)?.delete(a.eventId);
      return null;
    case "plugin:event|emit":
    case "plugin:event|emit_to":
      emit(a.event, a.payload);
      return null;
    // window, opener
    case "plugin:window|is_focused":
      return true; // no notification banners
    case "plugin:window|theme":
      return settings.theme === "dark" ? "dark" : "light";
    case "plugin:window|set_theme":
    case "webview_theme":
    case "plugin:window|set_title":
    case "plugin:opener|open_url":
      return null;
    // the deep-link plugin: the link the app was started with (later ones come as the deep-link://new-url event)
    case "plugin:deep-link|get_current":
      return query.get("link") ? [query.get("link")] : null;

    // Relay's updates and the agent CLIs (Settings › Updates): 0.0.21 installed, 0.0.23 out, 0.0.22 skipped
    case "updates_status":
    case "updates_check":
      return {
        version: "0.0.21",
        checked: Date.parse("2026-10-12T09:41:00Z"),
        latest: "0.0.23",
        error: null,
        releases: [
          {
            version: "0.0.23",
            date: "2026-10-12T08:00:00Z",
            notes:
              "### Added\n\n- **Updates in Settings**: Settings › Updates shows the releases since your version and installs the newest, and updates the coding agents (#190)\n\n### Fixed\n\n- **Cmd-K**: a search for a ticket number finds it on every board",
          },
          {
            version: "0.0.22",
            date: "2026-10-10T08:00:00Z",
            notes: "### Changed\n\n- **Permission cards** wait for `Always allow` answers per tool",
          },
          { version: "0.0.21", date: "2026-10-08T08:00:00Z", notes: "### Added\n\n- an older release, not shown" },
        ],
      };
    case "updates_install":
      [0.2, 0.55, 1].forEach((f, i) =>
        setTimeout(() => emit("update-progress", { done: f * 24e6, total: 24e6 }), 300 * (i + 1)),
      );
      return new Promise(() => {}); // the app restarts
    case "agent_updates":
      return [
        {
          id: "claude",
          name: "Claude Code",
          on: true,
          installed: "2.1.289",
          latest: "2.1.296",
          command:
            "/Users/me/.npm-global/bin/npm install -g --prefix /Users/me/.npm-global @anthropic-ai/claude-code@latest",
        },
        {
          id: "codex",
          name: "Codex",
          on: true,
          installed: "0.162.1",
          latest: "0.162.1",
          command: "/opt/homebrew/bin/brew upgrade codex",
        },
        { id: "opencode", name: "OpenCode", on: false, installed: "1.1.6", latest: "1.19.0", command: null },
        { id: "pi", name: "Pi", on: false, installed: null, latest: null, command: null },
      ];
    case "agent_update":
      return new Promise(resolve => setTimeout(() => resolve(null), 400));
    // work machines (fixture "machines": one that speaks an older protocol, "phone", "nomirror" and shared: online)
    case "machine_status":
      // shared-keeper: a server older than this Relay, so its row offers the update
      if (fixture === "shared-keeper") return { ok: true, version: "0.0.3", os: "linux", host: "server", update: true };
      if (fixture === "phone" || fixture === "mirror" || fixture === "nomirror" || shared)
        return { ok: true, version: "0.0.14", os: "linux", host: "server", update: true };
      if (fixture === "github")
        return { ok: true, version: "0.0.25", os: "linux", host: "server", update: true, repos: true };
      return {
        ok: false,
        outdated: "server",
        version: "0.1.0",
        error: "relay-server 0.1.0 speaks protocol 1, this Relay 2",
      };
    // a pairing for a phone: the line and a QR, here a stand-in square pattern
    case "machine_pair_phone":
      return {
        line: `relay://192.168.1.2:47800#fp=${"0f9534960dd3570a".padEnd(64, "0")}&code=${"c".repeat(32)}&key=${"k".repeat(64)}&link=${"l".repeat(64)}`,
        ntfy: "https://ntfy.sh/relay-0123456789abcdef0123456789abcdef",
        qr: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21" shape-rendering="crispEdges"><rect width="21" height="21" fill="#fff"/><path d="M0 0h7v7H0zM14 0h7v7h-7zM0 14h7v7H0zM9 9h3v3H9zM15 15h2v2h-2z" fill="#000"/></svg>`,
      };
    case "server_setup":
      return { version: "0.0.4", image: "ghcr.io/relay-inc/relay-server" };
    // fixture "mirror": an agent there deleted a folder, the round holds the 9 deletes back; Restore and Delete answer
    case "mirror_status":
      return fixture === "mirror"
        ? {
            at: NOW_S - 40,
            pushed: 12,
            pulled: 3,
            conflicts: [],
            skipped: [],
            errors: [],
            held: Array.from(
              { length: 9 },
              (_, i) => `vault/Contexts/Work/Projects/Harbor CRM/Documents/Note ${i + 1}.md`,
            ),
            locked: false,
            in_ram: true,
          }
        : null;
    case "mirror_allow_deletes":
    case "mirror_restore_held":
      return null;
    case "mirror_progress":
      return null;
    // GitHub and the repos on the machine (fixture "github"): Disconnect, then Connect shows the code, typed 5 s later
    case "machine_github":
      return structuredClone(github);
    case "machine_github_connect":
      return structuredClone(vault.machineGit.device);
    case "machine_github_poll":
      github = structuredClone(vault.machineGit.github);
      return structuredClone(github);
    case "machine_github_disconnect":
      github = { ...github, state: "off", login: "", since: "", name: "", email: "" };
      return null;
    case "machine_repos":
      return structuredClone(machineRepos);
    case "machine_repo_push":
    case "machine_repo_ensure": {
      const repo = machineRepos.find(r => r.name === a.name || r.repo === a.repo) ?? null;
      if (repo && cmd === "machine_repo_push") repo.unpushed = 0;
      return structuredClone(repo);
    }
    // back to this Mac from the machine (fixture "github"): harbor-crm has work there, until pushed or moved anyway
    case "move_conversation":
      if (fixture !== "github" || a.to !== "" || a.choice) return null;
      return Promise.reject(
        `repo-work:${JSON.stringify({ repo: "acme/harbor-crm", name: "harbor-crm", branch: "relay/server", machine: "Server" })}`,
      );
    case "machine_repo_to_mac":
      return new Promise(resolve =>
        setTimeout(() => resolve({ branch: "relay/server", dir: `/Users/demo/Code/${a.name}` }), 600),
      );
    case "host_status": // fixture "github": a development build, This Mac cannot be a machine
      return fixture === "github"
        ? { supported: false, on: false, running: false, ram: false, fingerprint: "", clients: [] }
        : null;
    // shared vaults on a relay-server (src-tauri/src/shared_vaults.rs), fixture "shared"
    case "shared_vaults_status":
      return structuredClone(sharedStatus);
    case "shared_vault_pending_invite": {
      const link = pendingInvite;
      pendingInvite = null;
      return link;
    }
    case "shared_vault_create": {
      if (!(settings.machines ?? []).some((m: { id: string }) => m.id === a.machine))
        return Promise.reject("pick a paired machine for the vault");
      const machine = settings.machines.find((m: { id: string }) => m.id === a.machine);
      const id = hex(16, 3);
      const { host, port, fp } = machine;
      settings.sharedVaults = [
        ...(settings.sharedVaults ?? []),
        { id, name: a.name.trim(), host, port, fp, folder: a.folder, role: "admin" },
      ];
      if (a.noHistory)
        sharedStatus[id] = {
          at: Math.floor(Date.now() / 1000),
          pushed: 0,
          pulled: 0,
          conflicts: [],
          errors: [],
          held: [],
          bad: 0,
          admin: true,
          nohistory: true,
        };
      return { id, recovery: hex(64, 5) };
    }
    // the key this Mac holds, the same one `shared_vault_create` gave
    case "shared_vault_trust": {
      const s = sharedStatus[a.id];
      if (s) {
        s.changed = (s.changed ?? []).filter((c: { fp: string }) => c.fp !== a.fp);
      }
      return null;
    }
    case "shared_vault_recovery":
      if (!(settings.sharedVaults ?? []).some((x: { id: string }) => x.id === a.id))
        return Promise.reject(`no workspace ${a.id}`);
      return hex(64, 5);
    case "shared_vault_join": {
      const id = /vault=([0-9a-f]{16})/.exec(a.link)?.[1];
      if (!id) return Promise.reject("not an invite link");
      const v = { id, name: "Northwind", host: "192.168.1.2", port: 47800, fp: "", folder: a.folder, role: "member" };
      settings.sharedVaults = [...(settings.sharedVaults ?? []).filter((x: { id: string }) => x.id !== id), v];
      return { id, name: v.name };
    }
    case "shared_vault_invite": {
      const invite = {
        id: hex(16, sharedInvites.length + 1),
        role: a.role,
        expires: Math.floor(Date.now() / 1000) + 86400,
      };
      sharedInvites = [...sharedInvites, invite];
      return { link: vault.inviteLink(invite.id), invite };
    }
    case "shared_vault_info": {
      const v = (settings.sharedVaults ?? []).find((x: { id: string }) => x.id === a.id);
      if (!v) return Promise.reject(`no workspace ${a.id}`);
      if (fixture === "shared-keeper" && v.role !== "admin") {
        v.role = "admin";
        settings.machines = [...(settings.machines ?? []), structuredClone(vault.keeperMachine)];
      }
      const invites = v.role === "admin" ? structuredClone(sharedInvites) : [];
      return {
        vault: {
          id: v.id,
          name: v.name,
          role: v.role,
          members: structuredClone(sharedMembers),
          people: structuredClone(sharedPeople),
          invites,
        },
        me: vault.SHARED_ME,
      };
    }
    // the organisation of a machine's server (src-tauri/src/organisation.rs), fixture "shared-org"
    case "org_status":
      return org
        ? {
            exists: true,
            me: true,
            owner: true,
            code: vault.ORG_CODE,
            admins: orgState.admins.map((x: { fp: string }) => x.fp),
            sso: orgSso,
          }
        : { exists: false, me: false, owner: true, code: vault.ORG_CODE, admins: [] };
    case "org_overview":
      return structuredClone(orgState);
    case "org_add_admin": {
      const c = orgState.candidates.find((x: { fp: string }) => x.fp === a.fp);
      if (!c || c.code !== a.code) return Promise.reject("the device's keys changed since you compared the code");
      orgState.candidates = orgState.candidates.filter((x: { fp: string }) => x.fp !== a.fp);
      orgState.admins = [...orgState.admins, { fp: c.fp, name: c.name }];
      return null;
    }
    case "org_remove_admin":
      orgState.admins = orgState.admins.filter((x: { fp: string }) => x.fp !== a.fp);
      return null;
    case "org_start":
      return null;
    case "org_sso":
      orgSso = a.sso;
      return null;
    case "sso_check":
      return { sso: inviteSso };
    // the browser's sign-in, as if it came back after a moment
    case "sso_login":
      return new Promise(r => setTimeout(r, 300)).then(() => ({
        id_token: "eyJ.harness.token",
        salt: hex(64, 7),
        email: "sofie.claes@example.com",
        name: "Sofie Claes",
      }));
    case "sso_cancel":
      return null;
    case "org_offboard": {
      const hit = (w: { members: { fp: string }[] }) => w.members.some(m => a.fps.includes(m.fp));
      const removed = orgState.workspaces.filter((w: any) => hit(w) && w.admin).map((w: any) => w.name);
      const skipped = orgState.workspaces.filter((w: any) => hit(w) && !w.admin).map((w: any) => w.name);
      for (const w of orgState.workspaces)
        if (w.admin) w.members = w.members.filter((m: { fp: string }) => !a.fps.includes(m.fp));
      orgState.people = orgState.people
        .map((p: any) => ({
          ...p,
          workspaces: p.workspaces.filter(
            (w: any) => !removed.includes(w.name) || !p.devices.some((d: any) => a.fps.includes(d.fp)),
          ),
        }))
        .filter((p: any) => !p.devices.every((d: any) => a.fps.includes(d.fp)) || p.workspaces.length);
      return { removed, skipped, failed: [], revoked: a.fps.length };
    }
    case "shared_vault_policy": {
      const s = sharedStatus[a.id];
      if (s) s.policy = { providers: a.providers, capture: a.capture };
      return null;
    }
    case "shared_vault_add_org":
      return 0;
    case "shared_vault_invite_revoke":
      sharedInvites = sharedInvites.filter(i => i.id !== a.invite);
      return null;
    case "shared_vault_remove":
      if (a.fp === vault.SHARED_ME) {
        settings.sharedVaults = (settings.sharedVaults ?? []).filter((x: { id: string }) => x.id !== a.id);
        delete sharedStatus[a.id];
      } else sharedMembers = sharedMembers.filter(m => m.fp !== a.fp);
      return null;
    case "shared_vault_held":
      // the next round: the held deletes the user saw (`paths`) went through or came back, newer ones stay held
      if (sharedStatus[a.id]) {
        const held = sharedStatus[a.id].held.filter((path: string) => !a.paths.includes(path));
        sharedStatus = { ...sharedStatus, [a.id]: { ...sharedStatus[a.id], held } };
      }
      setTimeout(() => emit("shared-vaults", structuredClone(sharedStatus)), 300);
      return null;
    case "machines_list":
      if (fixture === "github") return [{ id: "a1b2c3d4e5f6", name: "Server", online: true, default: false }];
      // shared: its Team server, so a new main-vault conversation's Runs on shows next to the Vault pick
      return shared ? [{ id: "a1b2c3d4e5f6", name: "Team server", online: true, default: false }] : [];
    // fixture "github": the Harbor CRM conversation that asks a question runs on Server
    case "chat_machines":
      return fixture === "github"
        ? { [conv.QUESTION_KEY]: { machine: "Server", id: "a1b2c3d4e5f6", cwd: "/home/relay/vault" } }
        : {};

    // settings, language, vault
    case "get_settings":
      return structuredClone(settings);
    case "set_settings":
      // the shared vaults are the backend's own: what the window sends for them is ignored
      settings = { ...structuredClone(a.settings), sharedVaults: settings.sharedVaults };
      if (settings.vault) vaultOk = true;
      return structuredClone(settings);
    case "ui_lang":
      return settings.language === "system" || !settings.language ? "en" : settings.language;
    case "ui_locale":
      return "en-GB";
    case "vault_status":
      return vault.vaultStatus(vaultOk);
    case "extra_vaults_status":
      return shared ? vault.teamStatus : [];
    case "detect_vault":
    case "check_vault":
      return { ...vault.vaultStatus(true), vault: a.path, ...(a.map ? { map: a.map } : {}) };
    case "create_default_vault":
      return { ...vault.vaultStatus(true), vault: "/Users/me/Relay" };
    case "pick_folder":
      return harness.pickFolder;
    case "pick_path":
      return null;
    // files attached by their path (src-tauri/src/files.rs)
    case "pick_files":
      return [...harness.pickFiles];
    case "pasted_files":
      return [...harness.pastedFiles];
    case "copy_text":
      return null;
    case "read_image": {
      const type = (
        { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" } as Record<
          string,
          string
        >
      )[String(a.path).split(".").pop()!.toLowerCase()];
      if (!type) return Promise.reject("not a picture");
      return [type, pngBase64(120, 80, "#e8efe3", "#3f8f4f")];
    }
    // files inside a page (src-tauri/src/attach.rs)
    case "embed_info":
      return (a.targets as string[]).map(t => views.baseInfo(t) ?? embeds.info([t])[0]);
    case "attach_dest":
      return "Attachments/2026";
    case "attach_save":
      attached.push({ page: String(a.page), name: String(a.name), bytes: String(a.data).length });
      return { path: `Attachments/2026/${a.name}`, link: a.name };
    case "attach_copy":
      return (a.paths as string[]).map(path => {
        const name = path.split("/").pop()!;
        attached.push({ page: String(a.page), name });
        return name === embeds.DUMP
          ? { tooLarge: true, name, size: 312_000_000 }
          : { path: `Attachments/2026/${name}`, link: name };
      });
    case "open_file":
      return String(a.path).includes("missing") ? Promise.reject("not found") : null;
    case "snapshot": {
      const base = vault.snapshot(reminders);
      // with the contexts and projects made from the Pages tab, and the states set there
      const all = [...base.projects, ...madeProjects].map(p => (states[p.name] ? { ...p, state: states[p.name] } : p));
      const snap = {
        ...base,
        projects: all,
        contexts: { [vault.VAULT]: [...new Set([...all.map(p => p.context), ...madeContexts])].sort() },
      };
      if (!shared) return snap;
      // a project moved by migrate_project lives in its new vault under its new key
      const own = snap.projects.map(p =>
        moved[p.name] ? { ...p, ...moved[p.name], label: p.name } : { ...p, vault: vault.VAULT, label: p.name },
      );
      return { ...snap, projects: [...own, ...vault.teamProjects] };
    }
    case "vault_notes":
      return {
        root: vault.VAULT,
        notes: shared
          ? [
              ...pageList(),
              ...vault.teamNotes,
              "/Users/me/Shared/Northwind/Clients/Northwind.md",
              "/Users/me/Shared/Northwind/CLAUDE.md",
              "/Users/me/Shared/Northwind/System/rules/team.md",
            ]
          : pageList(),
      };
    // the Pages tab's file operations, on the main vault's list (a move counts 3 links in 2 notes)
    case "create_note": {
      const folder = pageRel(a.parent);
      const path = `${folder ? `${folder}/` : ""}${String(a.name)}${a.folder ? "" : ".md"}`;
      if (!a.folder) {
        pages = [...pageList(), path];
        written.set(path, { text: "", hash: "h0" }); // an empty file, as the backend makes it
      }
      return path;
    }
    // contexts and projects from the Pages tab: a project's note goes to Contexts/<context>/Projects/<name>/
    case "create_context": {
      const path = `Contexts/${String(a.name)}/${String(a.name)}.md`;
      madeContexts.push(String(a.name));
      pages = [...pageList(), path];
      return path;
    }
    case "create_project": {
      const path = `Contexts/${String(a.context)}/Projects/${String(a.name)}/${String(a.name)}.md`;
      pages = [...pageList(), path];
      madeProjects.push({
        ...vault.snapshot().projects[0],
        name: String(a.name),
        context: String(a.context),
        state: String(a.status),
        summary: "",
        open: null,
        open_items: [],
        stand: null,
        aliases: [],
      });
      return path;
    }
    case "project_kinds":
      return ["Product", "Initiative", "Platform"];
    case "set_project_state":
      states[String(a.name)] = String(a.status);
      return null;
    // the workspace check: a few of each kind, gone once repaired
    case "vault_check":
      return VAULT_FINDINGS.filter(f => !repaired.has(f.id));
    case "vault_garden":
      return gardenFindings();
    case "garden_about":
      gardenDone.add(String(a.path));
      aboutSet.push([String(a.path), String(a.project)]);
      {
        // the note's about: set, as lib.rs `garden_about` writes it: the Pages tab's tree by type moves it (issue 420)
        const path = String(a.path);
        const about = `about: "[[${a.project}]]"`;
        const text = textOfNote(path);
        const next = text.startsWith("---\n")
          ? `---\n${about}\n${text.slice(4).replace(/^about:.*\n/m, "")}`
          : `---\n${about}\n---\n${text}`;
        written.set(path, { text: next, hash: `h${Date.now()}` });
      }
      return null;
    case "garden_ask": {
      const paths = (a.paths as string[]).slice(0, 20);
      const stem = (p: string) => p.split("/").pop()!.replace(/\.md$/, "");
      const edits = paths.map(p => [p, mockAction(String(a.action), p, null)[1][0][1]] as [string, string | null]);
      paths.forEach(p => gardenDone.add(p));
      recordChange(
        `action:${a.action}`,
        paths.length > 1 ? `${stem(paths[0])} +${paths.length - 1}` : stem(paths[0] ?? ""),
        `Ran ${a.action} on ${paths.length} notes`,
        edits,
      );
      return null;
    }
    case "tidy_preview":
      return TIDY;
    case "tidy_apply":
      tidied = true;
      return TIDY;
    case "tidy_undo":
      tidied = false;
      return TIDY.moves.length;
    case "vault_repair":
      (a.ids as string[]).forEach(id => repaired.add(id));
      return (a.ids as string[]).length;
    case "project_row":
      return a.row == null ? `| [[${String(a.name)}]] | Active | 2026-10-29 |  |` : null;
    case "free_page_name":
      return pageList().includes(`${pageRel(a.parent) ? `${pageRel(a.parent)}/` : ""}${String(a.name)}.md`)
        ? `${String(a.name)} 1`
        : String(a.name);
    case "duplicate_note": {
      const path = pageRel(a.target).replace(/\.md$/, " copy.md");
      pages = [...pageList(), path];
      return path;
    }
    case "move_path": {
      const [from, to] = [pageRel(a.from), pageRel(a.to)];
      if (!a.dry)
        pages = pageList().map(p => (p === from ? to : p.startsWith(`${from}/`) ? to + p.slice(from.length) : p));
      return { links: 3, notes: 2, path: to };
    }
    case "trash_path": {
      const path = pageRel(a.target);
      trashed.set(
        path,
        pageList().filter(p => p === path || p.startsWith(`${path}/`)),
      );
      pages = pageList().filter(p => !trashed.get(path)!.includes(p));
      return { root: vault.VAULT, trash: `.trash/${path.split("/").pop()}`, path };
    }
    case "restore_path":
      pages = [...pageList(), ...(trashed.get(String(a.path)) ?? [])];
      trashed.delete(String(a.path));
      return null;
    case "note_by_event":
      return eventNotes.get(String(a.event)) ?? null;
    case "note_home":
      return `Calendar/Meetings/${String(a.day).slice(0, 4)}`;
    case "read_note": {
      // a meeting note (`YYYY-MM-DD Title`) exists only when it was made or set with __harness.meetingNote
      const target = String(a.target);
      const made = [...written.keys()].find(k => k === target || k.endsWith(`/${target.replace(/\.md$/, "")}.md`));
      if (made) a.target = made;
      else if (
        /(^|\/)\d{4}-\d\d-\d\d /.test(target) &&
        !target.includes(vault.BRIEFING_NOTE) &&
        !pageList().some(n => n === target || n.endsWith(`/${target.replace(/\.md$/, "")}.md`))
      )
        return Promise.reject(`not found: ${target}`);
      const team = shared && vault.teamNotes.find(n => n.endsWith(`/${String(a.target).replace(/\.md$/, "")}.md`));
      const modified = Date.now() - 2 * 3600_000; // a page reads "Edited 2 h ago"
      lastPage = String(a.target);
      const note = vault.noteText(a.target);
      const read = { ...note, modified, ...written.get(String(a.target)), ...written.get(note.path) };
      return team ? { ...read, path: team, hash: "h0" } : { hash: "h0", ...read };
    }
    case "property_values":
      return (
        (
          { status: ["Active", "Blocked", "Quiet", "Paused"], type: ["Document", "Product", "Meeting"] } as Record<
            string,
            string[]
          >
        )[String(a.key)] ?? []
      );
    case "page_history": {
      // three sessions of the page's note: the newest is the note now, each older one a few lines shorter
      const now = String(vault.noteText(a.path).text ?? "");
      const cut = (n: number) => now.split("\n").slice(0, -n).join("\n") + "\n";
      const at = Date.now();
      return {
        kind: "doc",
        ...(anonymousDocs ? { anonymous: true } : {}),
        versions: [
          { key: "9", author: "Ana Vos", by: ["claude"], at: at - 20 * 60_000, text: now, added: 3, removed: 0 },
          { key: "6", author: "Ben Lauwers", by: [""], at: at - 3 * 3600_000, text: cut(3), added: 4, removed: 1 },
          { key: "2", author: "Ana Vos", by: ["disk"], at: at - 2 * 86_400_000, text: cut(7), added: 12, removed: 0 },
        ].map(v => (anonymousDocs ? { ...v, author: "" } : v)),
      };
    }
    case "page_comments": {
      // a note of this Mac's own: one open thread with a reply, one resolved; what the page adds comes after them
      const path = commentKey(a.path);
      if (!comments.has(path)) {
        const at = Date.now();
        comments.set(path, [
          {
            id: "c1",
            by: "Ana Vos",
            mine: false,
            k: "comment",
            t: "Is this still the first thing to do?",
            q: "First open loop",
            a: { o: 0 },
            m: teamComments ? [ME] : undefined,
            at: at - 3 * 3600_000,
          },
          {
            id: "r1",
            by: "Ben Lauwers",
            mine: false,
            k: "reply",
            on: "c1",
            t: "Yes, before the demo.",
            at: at - 2 * 3600_000,
          },
          {
            id: "c2",
            by: "Ana Vos",
            mine: false,
            k: "comment",
            t: "Which repo is the old one?",
            q: "The previous repo is archived",
            a: { o: 0 },
            at: at - 26 * 3600_000,
          },
          { id: "x2", by: "Ben Lauwers", mine: false, k: "resolve", on: "c2", at: at - 25 * 3600_000 },
        ]);
      }
      const threads = threadsOf(comments.get(path)!);
      if (anonymousDocs)
        return {
          kind: "doc",
          doc: "d1",
          anonymous: true,
          members: [],
          threads: threads.map(t => ({ ...unnamed(t), replies: t.replies.map(unnamed) })),
        };
      return teamComments ? { kind: "doc", doc: "d1", members: MEMBERS, threads } : { kind: "file", threads };
    }
    case "workspace_inbox":
      return [...comments].flatMap(([page, all]) =>
        threadsOf(all)
          .filter(t => !t.resolved && t.mentionsMe)
          .map(thread => ({ page, thread })),
      );
    case "page_comment": {
      const list = comments.get(commentKey(a.path)) ?? [];
      const id = `n${list.length + 1}`;
      list.push({
        id,
        by: "You",
        mine: true,
        k: String(a.kind),
        on: String(a.on),
        t: String(a.text),
        q: String(a.quote),
        a: a.anchor,
        m: (a.mentions as string[] | undefined) ?? [],
        at: Date.now(),
      });
      comments.set(commentKey(a.path), list);
      return id;
    }
    case "page_restore": {
      const hash = `h${++writes}`;
      written.set(String(a.path), { text: String(a.text), hash });
      return null;
    }
    case "write_note": {
      // a file changed on disk since the page read it (set with __harness.changeOnDisk): refused unless forced
      if (diskChanged && !a.force) return Promise.reject("changed");
      diskChanged = false;
      const hash = `h${++writes}`;
      written.set(String(a.target), { text: String(a.text), hash });
      lastSaved = String(a.target);
      return { hash };
    }
    case "shared_vault_role": {
      // an admin picks a member's role: the member list, and the server's role that follows it
      const s = sharedStatus[a.id];
      if (s?.admins)
        s.admins = [...s.admins.filter((fp: string) => fp !== a.fp), ...(a.role === "admin" ? [a.fp] : [])];
      if (s?.readers)
        s.readers = [...s.readers.filter((fp: string) => fp !== a.fp), ...(a.role === "reader" ? [a.fp] : [])];
      sharedMembers = sharedMembers.map(m => (m.fp === a.fp ? { ...m, role: a.role } : m));
      return null;
    }
    case "shared_vault_person": {
      // a person named or renamed (who "" a new one), and the device fp put under it
      const who = a.who || hex(64, sharedPeople.length + 1);
      const rest = sharedPeople
        .filter(p => p.who !== who)
        .map(p => ({ ...p, devices: p.devices.filter(fp => fp !== a.fp) }));
      const was = sharedPeople.find(p => p.who === who);
      const devices = [...(was?.devices ?? []), ...(a.fp && !was?.devices.includes(a.fp) ? [a.fp] : [])];
      sharedPeople = [...rest, { who, name: a.name, email: a.email, devices }];
      const s = sharedStatus[a.id];
      if (s) s.people = sharedPeople;
      return structuredClone(sharedPeople);
    }
    case "shared_vault_remove_person": {
      // the person with every device under it, null when this Mac was one of them (it left)
      const gone = sharedPeople.find(p => p.who === a.who)?.devices ?? [];
      sharedPeople = sharedPeople.filter(p => p.who !== a.who);
      if (gone.includes(vault.SHARED_ME)) {
        settings.sharedVaults = (settings.sharedVaults ?? []).filter((x: { id: string }) => x.id !== a.id);
        delete sharedStatus[a.id];
        return null;
      }
      sharedMembers = sharedMembers.filter(m => !gone.includes(m.fp));
      const s = sharedStatus[a.id];
      if (s) s.people = sharedPeople;
      return structuredClone(sharedPeople);
    }
    case "shared_vault_add": {
      // an admin's Add to list: the member is on the member list now, as member
      const s = sharedStatus[a.id];
      if (s?.listed) s.listed = [...s.listed.filter((fp: string) => fp !== a.fp), a.fp];
      return null;
    }
    case "shared_vault_docs": {
      // an admin's switch: the member list now says the notes are documents (or not)
      const s = sharedStatus[a.id];
      if (s) s.docs = !!a.on;
      return null;
    }
    case "shared_doc_open": {
      // shared-live: an absolute page (another workspace's note) is a document, seeded once from the note's text
      if (!live || !String(a.path).startsWith("/")) return null;
      if (!liveDoc.getText("md").length) liveDoc.getText("md").insert(0, vault.noteText(String(a.path)).text);
      const state = b64(Y.encodeStateAsUpdate(liveDoc));
      if (anonymousDocs) return { vault: "v1", doc: "d1", state, me: "5e55105e55105e55", name: "", anonymous: true };
      return { vault: "v1", doc: "d1", state, me: "me", name: "Alex" };
    }
    case "shared_doc_edit":
      Y.applyUpdate(liveDoc, unb64(String(a.update)), "editor");
      return null;
    case "shared_awareness":
      liveCursors.push(String(a.body));
      return null;
    case "shared_doc_absorb":
      // a shared workspace's document taking a file change: nothing to show in the harness
      return null;
    case "project_icons":
      return vault.projectIcons();
    case "project_repos":
      return vault.projectRepos;
    case "capture_proposals":
      // fixture capture: a closed conversation leaves two changes for the vault (Today's capture item)
      return fixture === "capture"
        ? [
            {
              title: "Launch date decided",
              file: "Contexts/Agency/Portfolio/Portal/Portal.md",
              change: "Add to **Status**: launch on 1 November (decided today), the launch mail is Jan's.",
            },
            {
              title: "Follow-up with Jan",
              file: "Resources/Meta/Claude/reminders.md",
              change: "- 2026-10-28: check that Jan has the launch mail ready",
            },
          ]
        : [];
    case "favicons":
    case "find_icon_sites":
    case "integration_import":
      return {};
    case "design_link":
      return "";
    case "design_show":
    case "design_bounds":
    case "design_hide":
    case "design_opened":
    case "set_design_link":
    case "set_project_icon":
    case "move_chat_workspace":
    // a project moved or copied to another workspace: what goes, a team workspace's warning, and Northwind Portal into
    // the side vault, which has a project of that name
    case "migrate_project": {
      const name = String(a.project).split("\u001f")[0];
      const team = vault.sharedVaults.some(v => v.folder === a.to);
      const contexts = team ? ["Team", "Work"] : ["Agency", "Team"];
      const context = String(a.context) || (contexts.includes("Agency") ? "Agency" : contexts[0]);
      const base = `Contexts/${context}/${team ? "Projects" : "Portfolio"}/${name}`;
      const files = [`${base}/Documents/Kick-off.md`, `${base}/Documents/Scope.md`, `${base}/${name}.md`];
      const clash = a.to === vault.TEAM_VAULT && name === "Northwind Portal";
      const key = `${name}\u001f5f2c8e91a7d04b36`;
      // on a move each started conversation goes along, except one that read mail into a team workspace
      const chats =
        a.mode === "move"
          ? (a.chats ?? []).map((c: any) => ({
              key: c.key,
              title: c.title,
              moves: !(team && c.mail),
              why: team && c.mail ? "mail" : "",
            }))
          : [];
      if (!a.dry && a.mode === "move") moved[name] = { name: key, vault: String(a.to) };
      return {
        chats,
        files,
        scratch: 1,
        skipped: team ? [`Contexts/Agency/Portfolio/${name}/.claude/settings.json`] : [],
        conflicts: clash ? [name, `${base}/${name}.md`] : [],
        row: true,
        card: team,
        icon: true,
        design: false,
        repos: 1,
        contexts,
        context,
        team,
        key,
      };
    }
    case "set_project_repos":
    case "ignore_repo":
      return null;
    case "reminder":
      reminders = vault.remindersAfter(reminders, a.action, a, 0);
      return reminders.find(r => r.id === a.id)?.date ?? "";
    case "reminder_add":
      reminders = vault.remindersAfter(reminders, "add", a, ++added);
      return reminders.at(-1)!.id;

    // agents and conversations
    case "agents_status":
      return fixture === "models" ? integ.agentsStatusManyModels : integ.agentsStatus;
    case "agent_commands":
      return integ.agentCommands(a.provider);
    case "action_config":
      return { actions: integ.actions, config: structuredClone(actionConfig) };
    case "set_action_config":
      if (Object.keys(a.entry).length) actionConfig[a.ext] = a.entry;
      else delete actionConfig[a.ext];
      return structuredClone(actionConfig);
    case "chats":
      // the backend has a session for the coordinator and its workers too
      return [...conv.conversations.map(c => c.key), ...(orchOn ? [orch.ORCH, ...workers.map(w => w.key)] : [])];
    case "chat_providers":
      return Object.fromEntries(conv.conversations.map(c => [c.key, c.provider]));
    case "app_sids":
      return conv.conversations.map(c => conv.sidOf(c.key));
    case "app_sessions":
      return sidKeys();
    case "activity": {
      // the user's own messages that day in the first four sessions: 9:00, 11:00 and 14:00, a little shifted per session
      const day = Date.parse(`${a.date}T00:00:00+02:00`);
      return Object.fromEntries(
        (a.sessions as string[])
          .slice(0, 4)
          .map((sid, i) => [sid, [9, 9.2, 11, 11.1, 14].map(h => day + (h + i * 0.05) * 3600_000)]),
      );
    }
    case "agents":
      return terminalAgents();
    case "running":
      return {}; // conversation key -> turns running, for the processes the app started
    // the phone (mobile.html): the paired machine, the laptop's conversations there, following one
    case "info":
      return { host: "server", version: "0.0.15", mirror_open: true };
    case "conversations":
      return [conv.PERMISSION_KEY, conv.LONG_KEY].map(key => ({
        key,
        title: conv.conversations.find(c => c.key === key)?.title ?? null,
        provider: "claude",
        model: "sonnet",
        effort: "",
        sid: conv.sidOf(key),
      }));
    case "open":
      return null;
    // the Git drawer: Beacon Billing's two checkouts, staged, discarded and committed in memory
    case "git_repos":
      return a.project === "Beacon Billing" ? structuredClone(gitRepos) : [];
    case "git_log":
      return git.log(a.repo, a.all);
    case "git_show":
      return git.show(a.hash);
    case "git_pull":
      return null;
    // the Files drawer
    case "file_roots":
      return files.roots(a.project);
    case "list_dir":
      return files.list(a.path);
    case "read_file_text":
      return files.read(a.path);
    case "git_stage":
    case "git_discard":
    case "git_commit": {
      const repo = gitRepos.find(r => r.repo === a.repo);
      if (!repo) return Promise.reject(`${a.repo} is not a repo of ${a.project}`);
      if (cmd === "git_stage")
        for (const f of repo.files.filter(f => a.paths.includes(f.path)))
          Object.assign(f, { staged: a.on, untracked: false, status: f.untracked ? "A" : f.status });
      if (cmd === "git_discard") repo.files = repo.files.filter(f => f.path !== a.path);
      if (cmd === "git_commit") {
        if (!repo.files.some(f => f.staged)) return Promise.reject("no changes added to commit");
        repo.files = repo.files.filter(f => !f.staged);
        repo.ahead++;
        if (a.push && repo.name === "beacon-api") return Promise.reject(git.pushRejected);
        if (a.push) repo.ahead = 0;
      }
      return null;
    }
    case "drop_worktrees":
      // the switch-to conversation made one git worktree, removed when it closes
      return a.project === conv.SWITCH_KEY ? { removed: 1, kept: 0 } : { removed: 0, kept: 0 };
    case "history":
      if ((orchEmpty || orchClosed) && a.project === orch.ORCH) return [];
      return (orchOn && orch.history(a.project)) || conv.history(a.project);
    // the orchestrator: its workers, and Stop, which reports the new state as an `orch` event
    case "orch_workers":
      harness.workersRead = true;
      return structuredClone(workers);
    case "orch_stop": {
      const worker = workers.find(w => w.key === a.key);
      if (!worker || worker.state !== "running") return false;
      Object.assign(worker, { state: "stopped", ended: Date.now() });
      setTimeout(() => emit("orch", { type: "worker", worker: structuredClone(worker) }), 0);
      return true;
    }
    // the board pipeline: a worker on a ticket, a follow-up, its PR (open, nothing new), what it did on the board
    case "orch_dispatch_ticket": {
      const worker = {
        key: `c:orch-w-t${workers.length}`,
        project: a.project,
        title: a.title,
        task: a.task,
        repo: a.repo,
        worktree: `${a.repo}-relay-t${workers.length}`,
        branch: `relay/ticket-t${workers.length}`,
        state: "running",
        at: Date.now(),
        ended: null,
        report: null,
        ticket: a.ticket,
        base_branch: a.base || "main",
        pr: null,
        pr_error: null,
        board: null,
      } as (typeof workers)[number];
      workers.push(worker);
      setTimeout(() => emit("orch", { type: "worker", worker: structuredClone(worker) }), 0);
      return structuredClone(worker);
    }
    case "orch_message": {
      const worker = workers.find(w => w.key === a.key);
      if (worker) Object.assign(worker, { state: "running", ended: null });
      if (worker) setTimeout(() => emit("orch", { type: "worker", worker: structuredClone(worker) }), 0);
      return null;
    }
    // a question answered (kept on the worker), a silent worker asked for its report, one started again
    case "orch_answer": {
      const worker = workers.find(w => w.key === a.key);
      if (worker) worker.answer = a.answer;
      if (worker) setTimeout(() => emit("orch", { type: "worker", worker: structuredClone(worker) }), 0);
      return worker ? structuredClone(worker) : null;
    }
    case "orch_ask_report": {
      const worker = workers.find(w => w.key === a.key);
      if (worker) Object.assign(worker, { state: "running", ended: null });
      if (worker) setTimeout(() => emit("orch", { type: "worker", worker: structuredClone(worker) }), 0);
      return null;
    }
    case "orch_restart": {
      const old = workers.find(w => w.key === a.key)!;
      const worker = {
        ...structuredClone(old),
        key: `${old.key}r`,
        state: "running",
        at: Date.now(),
        ended: null,
        report: null,
      };
      workers.push(worker);
      setTimeout(() => emit("orch", { type: "worker", worker: structuredClone(worker) }), 0);
      return structuredClone(worker);
    }
    case "orch_pr":
      return structuredClone(prStatus);
    case "orch_board": {
      const worker = workers.find(w => w.key === a.key);
      if (worker) worker.board = a.mark;
      if (worker) setTimeout(() => emit("orch", { type: "worker", worker: structuredClone(worker) }), 0);
      return worker ? structuredClone(worker) : null;
    }
    case "history_sid": {
      const items = conv.terminalHistory(a.sid);
      return (a.from ?? 0) === 0 ? { items, next: items.length ? 4096 : 0 } : { items: [], next: a.from };
    }
    case "subagents":
      return Object.fromEntries(
        (a.keys as string[])
          .filter(k => k in conv.subagents)
          .map(k => [k, conv.subagents[k as keyof typeof conv.subagents]]),
      );
    case "agent_history": {
      const items = conv.agentHistory(a.id);
      return (a.from ?? 0) === 0 ? { items, next: items.length ? 4096 : 0 } : { items: [], next: a.from };
    }
    case "pending":
      return pending;
    case "answer":
      pending = pending.filter(x => x.id !== a.id);
      return null;
    case "send":
      // a picked vault is one of the vaults here, as the backend checks (policy::picked_vault)
      if (
        a.vault &&
        ![
          settings.vault,
          ...(settings.extraVaults ?? []),
          ...(settings.sharedVaults ?? []).map((v: { folder: string }) => v.folder),
        ].includes(a.vault)
      )
        return Promise.reject(`${a.vault} is not one of the vaults here`);
      // Claude Code echoes a message when it takes it up (--replay-user-messages); `echo: false` keeps it unread
      if (harness.echo && (a.provider ?? "claude") === "claude")
        setTimeout(() => emitAgent(a.project, { type: "picked", text: a.text }), 0);
      if (harness.autoReply)
        setTimeout(() => harness.stream({ key: a.project, deltas: 40, tokensPerDelta: 3, ratePerSecond: 60 }), 30);
      return null;
    case "ai_title":
      return String(a.text).split(/\s+/).slice(0, 5).join(" ");
    // the embedded terminals: a shell that prints a prompt and echoes what is typed
    // retries waiting for a usage limit to reset (src-tauri/src/retry.rs): none
    case "retries":
      return [];
    case "vault_sync":
      return structuredClone(vaultSync);
    case "set_vault_sync":
      vaultSync = { ...vaultSync, remote: a.remote, on: a.on && !!a.remote, minutes: a.minutes };
      return structuredClone(vaultSync);
    // the UI state file (src/infrastructure/storage.ts): empty, so the app takes over the fixtures' localStorage
    case "ui_state_get": {
      // ?keep=1: the Pages tab's folds and sorts the app saved before the reload (a restart reads them from the UI state
      // file), on top of what the harness seeded
      if (keepState) {
        const seeded = Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key) ?? ""]));
        const kept = ["pagesOpen", "pagesSort", "pagesFiles", "railClosed", "recentRemoved"].flatMap(k => {
          const v = sessionStorage.getItem(`mockUi:${k}`);
          return v == null ? [] : [[k, v]];
        });
        return { ...seeded, ...Object.fromEntries(kept) };
      }
      if (!orchClosed) return {};
      // on top of what the harness seeded (the selection), which a non-empty state would otherwise replace
      const seeded = Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key) ?? ""]));
      const closed = workers.map(w => [
        w.key,
        {
          key: w.key,
          at: w.at,
          project: w.project,
          title: w.title,
          draft: false,
          provider: "claude",
          orch: true,
          closed: w.at + 1,
        },
      ]);
      return {
        ...seeded,
        chats: JSON.stringify({ ...JSON.parse(seeded.chats || "{}"), ...Object.fromEntries(closed) }),
      };
    }
    case "ui_state_init":
      return a.state;
    case "active_window":
      return "main";
    case "ui_state_set":
      localStorage.setItem(a.key, a.value);
      if (keepState) sessionStorage.setItem(`mockUi:${a.key}`, a.value);
      return null;
    case "dictation_models":
      return structuredClone(voiceModels);
    case "dictation_model":
    case "permissions":
      return { microphone: "ok", accessibility: "ok", fullDisk: "missing", systemAudio: null, notifications: null };
    case "permissions_open":
      return null;
    case "dictation_access":
    case "dictation_ask_access":
      return true;
    case "dictation_download":
    case "dictation_delete":
    case "dictation_pause_shortcuts":
      return null;
    case "dictation_start":
      dictationLevels = { channel: channelId(a.onLevel), index: 0 };
      return null;
    case "dictation_stop":
      dictationLevels = null;
      return "Dictated in the harness.";
    case "dictation_cancel":
      dictationLevels = null;
      return null;
    case "meeting_record_start":
      meetingTicks = { channel: channelId(a.onTick), index: 0 };
      return { system: true, why: null };
    case "meeting_record_stop":
      meetingTicks = null;
      return {
        audio: "Attachments/2026-10-01 0930 Meeting.m4a",
        transcript: "Attachments/2026-10-01 0930 Meeting.md",
        seconds: 60,
      };
    case "meeting_kept":
      return fixture === "kept-recording" ? [{ folder: "20260930-152600", meeting: null }] : [];
    case "meeting_record_retry": // in the kept-recording fixture it never ends, to look at the saving state
      if (fixture === "kept-recording") return new Promise(() => {});
      return { audio: null, transcript: "Attachments/2026-09-30 1526 Meeting.md", seconds: 60 };
    case "meeting_record_cancel":
      meetingTicks = null;
      return null;
    case "pty_spawn": {
      const id = ++ptyId;
      const channel = typeof a.onData === "object" ? a.onData.id : Number(String(a.onData).split(":")[1]);
      ptys.set(id, { channel, index: 0 });
      setTimeout(() => ptyOut(id, a.chat ? `${PROMPT}claude --resume\r\n` : `${PROMPT}`), 20);
      return id;
    }
    case "pty_write":
      ptyOut(a.id, String(a.data).replace(/\r/g, `\r\n${PROMPT}`));
      return null;
    case "pty_resize":
      return null;
    case "pty_kill":
      ptys.delete(a.id);
      return null;
    // scratch notes per project, in memory
    case "related_notes":
      return [];
    case "scratch_list":
      return (scratch.get(a.project) ?? []).map(n => ({ ...n }));
    case "scratch_save": {
      const list = scratch.get(a.project) ?? [];
      const id = a.id ?? `note-${++scratchId}`;
      const note = list.find(n => n.id === id);
      if (note) Object.assign(note, { text: a.text, modified: NOW_S });
      else list.unshift({ id, text: a.text, modified: NOW_S });
      scratch.set(a.project, list);
      return id;
    }
    // the Inbox and quick capture (K7): the notes are the written ones under Inbox/, as inbox.rs lists them
    case "inbox_list":
      return [...written.keys()]
        .filter(k => k.startsWith(`${inbox.DIR}/`))
        .sort()
        .reverse()
        .map((path, i) => ({ path, text: written.get(path)!.text, modified: NOW_S - i * 60 }));
    case "inbox_home":
      return inbox.homes[String(a.kind).toLowerCase()] ?? null;
    case "inbox_propose": {
      const items = [...written.keys()]
        .filter(k => k.startsWith(`${inbox.DIR}/`))
        .sort()
        .reverse()
        .map(path => {
          const given = inbox.notes.find(n => n.path === path)?.proposal;
          const stem = path.split("/").pop()!.replace(/\.md$/, "");
          return { path, ...(given ?? { title: stem, type: "", dest: inbox.DIR, links: [] }) };
        })
        .map(({ path, title, type, dest, links }) => ({ path, title, type, dest, links }));
      return { at: inbox.proposedAt, items };
    }
    case "inbox_accept": {
      const filed: { path: string; to: string }[] = [];
      const failed: { path: string; error: string }[] = [];
      const files: Change["files"] = [];
      for (const item of a.items as {
        path: string;
        title: string;
        type: string;
        dest: string;
        links: { k: string; v: string }[];
      }[]) {
        const before = noteNow(item.path);
        if (before === null) {
          failed.push({ path: item.path, error: `not in the Inbox: ${item.path}` });
          continue;
        }
        const to = `${item.dest}/${item.title}.md`;
        const after = inbox.filed(before, item);
        putNote(item.path, null);
        putNote(to, after);
        pages = [...pageList().filter(p => p !== item.path), to];
        files.push(
          { path: item.path, before, after: null, state: "open" },
          { path: to, before: null, after, state: "open" },
        );
        filed.push({ path: item.path, to });
      }
      if (files.length) {
        const kinds = [...new Set(filed.map((_, i) => (a.items as { type: string }[])[i]?.type || "Note"))];
        const count = (k: string) => (a.items as { type: string }[]).filter(x => (x.type || "Note") === k).length;
        const reason = `Filed ${filed.length} ${filed.length === 1 ? "capture" : "captures"}: ${kinds.map(k => `${count(k)} ${k}`).join(", ")}`;
        changes = [
          { id: `${Date.now()}-${changes.length}`, at: Date.now(), source: "inbox", subject: "", reason, files },
          ...changes,
        ];
        emit("changes-changed", null);
      }
      emit("inbox-changed", null);
      return { filed, failed };
    }
    // the capture window's save: a note in the Inbox, named for the minute (inbox.rs `capture`)
    case "quick_capture_save": {
      const path = `${inbox.DIR}/2026-10-01 0930.md`;
      putNote(path, `${String(a.text).trimEnd()}\n`);
      pages = [...pageList(), path];
      emit("inbox-changed", null);
      return path;
    }
    case "quick_capture_hide":
      return null;
    case "scratch_delete":
      scratch.set(
        a.project,
        (scratch.get(a.project) ?? []).filter(n => n.id !== a.id),
      );
      return null;
    case "stop":
    case "bg":
    case "open_terminal":
    // /share-phone: shared conversations in memory; a conversation about a mail is refused, as the backend does
    case "phone_share": {
      if (a.on && a.mail) throw new Error("A conversation about a mail stays on this Mac, also from the phone");
      phoneShared.delete(a.key);
      if (a.on) phoneShared.add(a.key);
      return null;
    }
    case "phone_shared":
      return [...phoneShared];
    case "notify":
    case "open_settings_window":
      return null;
    case "usage_limits":
      return integ.usageLimits;
    case "usage_tokens":
      return integ.usageTokens();

    // the Pages graph and Recent
    case "notes_graph":
      return graph.graph();
    case "note_touches":
      return kbOn ? [...graph.touches(), ...kb.touches()] : graph.touches();
    case "note_rail":
      return kbOn && a.folder === vault.VAULT
        ? kb.rail(String(a.path), p => written.get(p)?.text)
        : { backlinks: [], mentions: [], related: [] };
    case "notes_linked":
      return linkedOn ? vault.linkedNotes() : [];
    // the collections (issue 373): every note with its frontmatter values, read from the note's text as related.rs does;
    // the saved views are in sessionStorage with ?keep=1 (a restart), else in memory
    // the type registry (issue 418): the shipped one
    case "note_types":
      return SHIPPED;
    case "notes_collection":
      // the main vault's notes; another workspace's are not indexed here
      if (a.folder && a.folder !== vault.VAULT) return [];
      return [...new Set(pageList())].map(path => collectionRow(path, textOfNote(path)));
    case "views_list":
      return savedViews();
    case "view_save": {
      const list = savedViews().filter(v => v.name !== a.name);
      keptViews([...list, { name: String(a.name), view: a.view }]);
      return null;
    }
    case "view_delete":
      keptViews(savedViews().filter(v => v.name !== a.name));
      return null;

    // the knowledge base (K5, K1): ⌘K's search, templates, today's note and the pinned notes. The favourites are kept in
    // sessionStorage with ?keep=1, so a reload shows them back the way `.relay/config.json` does after a restart.
    case "find_notes":
      return kbOn ? kb.find(a.folder === vault.VAULT, String(a.query)) : { names: [], content: [] };
    case "note_icons":
      return Object.fromEntries(
        pageList().flatMap(path => {
          const icon = collectionRow(path, textOfNote(path)).props.icon?.[0];
          return icon ? [[path, icon]] : [];
        }),
      );
    case "note_times":
      return Object.fromEntries(pageList().map((p, i) => [p, NOW_S - i * 3600]));
    case "note_templates":
      return kbOn ? kb.templates : [];
    case "new_from_template": {
      const day = new Date(NOW).toISOString().slice(0, 10);
      const home = a.template === "Meeting" ? `Calendar/Meetings/${day.slice(0, 4)}` : String(a.folder);
      const title = String(a.title || "") || String(a.template);
      const name = a.template === "Meeting" ? `${day} ${a.about ? `${a.about} ` : ""}${title}` : title;
      const path = `${home ? `${home}/` : ""}${name}.md`;
      const links = [a.context && `context: "[[${a.context}]]"`, a.about && `about: "[[${a.about}]]"`].filter(Boolean);
      pages = [...pageList(), path];
      written.set(path, { text: `---\ntype: ${a.template}\n${links.join("\n")}\n---\n# ${name}\n`, hash: "h0" });
      return path;
    }
    case "daily_note": {
      const path = kb.dailyPath(new Date(NOW).toISOString().slice(0, 10));
      if (!pageList().includes(path)) {
        pages = [...pageList(), path];
        written.set(path, { text: "---\ntype: Daily\n---\n", hash: "h0" });
      }
      return path;
    }
    case "changes_list":
      return structuredClone(changes);
    case "change_keep":
      for (const e of changes.filter(e => e.id === a.id))
        for (const f of e.files) if ((!a.path || f.path === a.path) && f.state === "open") f.state = "kept";
      return null;
    case "change_undo": {
      const f = changes.find(e => e.id === a.id)?.files.find(f => f.path === a.path && f.state === "open");
      if (!f) return Promise.reject("already reviewed");
      const current = noteNow(f.path);
      if (current !== f.after) return { merge: true, current, before: f.before, after: f.after };
      putNote(f.path, f.before);
      // a note that is back in the vault, or gone from it, is in the Pages list too
      pages =
        f.before === null
          ? pageList().filter(p => p !== f.path)
          : pageList().includes(f.path)
            ? pageList()
            : [...pageList(), f.path];
      f.state = "undone";
      return { merge: false };
    }
    case "change_resolve": {
      const f = changes.find(e => e.id === a.id)?.files.find(f => f.path === a.path && f.state === "open");
      if (!f) return Promise.reject("already reviewed");
      if (noteNow(f.path) !== a.expect) return Promise.reject("changed");
      putNote(f.path, String(a.text));
      f.state = "undone";
      return null;
    }
    case "page_action": {
      const [reason, edits] = mockAction(String(a.action), String(a.path), (a.selection as string | null) ?? null);
      recordChange(`action:${a.action}`, String(a.path).split("/").pop()!.replace(/\.md$/, ""), reason, edits);
      return null;
    }
    case "change_record": {
      const files = (a.files as { path: string; before: string | null; after: string | null }[]).filter(
        f => f.before !== f.after,
      );
      if (files.length) {
        changes = [
          {
            id: `${Date.now()}-${changes.length}`,
            at: Date.now(),
            source: String(a.source),
            subject: String(a.subject),
            reason: String(a.reason),
            files: files.map(f => ({ ...f, state: "open" })),
          },
          ...changes,
        ];
        emit("changes-changed", null);
      }
      return null;
    }
    case "capture_vault":
      recordChange(
        "capture",
        String(a.title ?? ""),
        kb.capture.reason,
        kb.capture.files.map(f => [f.path, f.after]),
      );
      return null;
    case "favourites":
      return kbOn ? favourites : [];
    case "set_favourites":
      favourites = (a.paths as string[]).slice();
      if (keepState) sessionStorage.setItem("mockFavourites", JSON.stringify(favourites));
      return favourites;

    // GitHub, mail, boards
    case "github_status":
      return "lena";
    case "github_prs":
      return integ.prs;
    case "github_pr":
      return integ.prDetail(a.repo, a.number);
    case "mail_list":
      return integ.mailPage(a.account, a.page ?? 1, movedMails, !!settings.mail?.experimental);
    case "mail_read":
      return integ.mailBody(a.id);
    case "mail_seen":
      return null;
    // Today's mail detail (src-tauri mail_tool): the thread, the reply headers, a draft saved
    case "mail_tool": {
      const m = [...integ.mails, ...integ.studioMails].find(x => x.id === a.args?.id) ?? integ.mails[0];
      const text = integ.mailBody(m.id).text;
      if (a.name === "attachment")
        return { path: `/Users/harness/Downloads/Relay-mail/attachment-${a.args?.index}.pdf` };
      if (a.name === "thread")
        return {
          account: m.account,
          messages: [
            {
              id: "4999",
              from: m.to,
              date: new Date(NOW - 30 * 3600_000).toISOString(),
              subject: m.subject,
              untrusted_mail:
                "Hi, here is the first version of the checklist. Let me know what is missing before Friday.",
            },
            { id: m.id, from: m.from, date: m.date, subject: m.subject, untrusted_mail: text },
          ],
        };
      if (a.name === "read")
        return {
          account: m.account,
          id: m.id,
          from: m.from,
          to: m.to,
          cc: [{ name: "Tom Willems", email: "tom@acme.example" }],
          subject: m.subject,
          date: m.date,
          message_id: `${m.id}@mail.example`,
          untrusted_headers: { "Reply-To": null, References: null },
          untrusted_mail: text,
        };
      return { account: m.account, folder: "[Gmail]/Drafts", saved: true, to: [], cc: [], bcc: [] };
    }
    // one Claude call without tools (src-tauri ai_write): findings, quick replies, an answer on a line, or a draft
    case "ai_write":
      // a meeting's wrap-up (prompts/meetings/wrapup.md): the draft as JSON, or never, or failing (__harness.wrapupMode)
      if (/verslag van een meeting/.test(a.system)) {
        if (wrapupMode === "slow") return new Promise(() => {});
        if (wrapupMode === "fail") return Promise.reject("claude exited with code 1");
        return JSON.stringify({
          summary_md:
            "Tom en ik overliepen de sprint 23 demo en de planning voor sprint 24. De prijssimulatie schuift naar sprint 24; de hosting migratie gebeurt op zaterdag 15 november. Wie de beveiligingsaudit opneemt, is nog open.\n\n- API-koppeling werkt op staging; de demo liep zonder problemen.\n- Simulator komt in sprint 24, niet 25.\n- Downtime-venster: zaterdag 15 nov, 06:00 – 08:00.\n- Beveiligingsaudit: Tom checkt met Sofie wie het opneemt.\n\n**Lena's way of working**\n- Lena bouwt de rapport-API\n- Progress te checken\n- Voorstel: korte check-in",
          next_steps: [
            { text: "Agenda in het kanaal posten zodat Sofie het weet", route: "reminder", due: "2026-10-01" },
            {
              text: "Met Lena bespreken: begrijpen wat hij bouwt, sneller vragen",
              route: "reminder",
              due: "2026-10-02",
            },
            { text: "pricing-velden simulator uitwerken", route: "ticket" },
          ],
          decisions: ["Pricing-simulator in sprint 24", "Migratie op zaterdag 15 nov, 06:00"],
        });
      }
      // the follow-up mail after a meeting (prompts/meetings/followup.md)
      if (/opvolgmail na een meeting/.test(a.system)) {
        if (followupMode === "slow") return new Promise(() => {});
        if (followupMode === "fail") return Promise.reject("claude exited with code 1");
        return JSON.stringify({
          subject: "Recap Sprint review Northwind Portal – 1 okt",
          body: "Hoi allemaal,\n\nKort verslag van de sprint review. De prijssimulatie gaat mee in sprint 24, en de hosting migratie plannen we op zaterdag 15 november van 06:00 tot 08:00.\n\nVolgende stappen\n- Ik: agenda in het kanaal posten, zodat Sofie het weet (vandaag)\n- Ik: pricing-velden voor de simulator uitwerken (ticket)\n- Sofie: met Sofie afstemmen wie de beveiligingsaudit opneemt\n\nGroetjes",
        });
      }
      if (/git commit message/.test(a.system)) return git.commitMessage;
      // a PR to a ticket: the invoice PR is ticket 300, anything else none
      if (/koppelt een pull request/.test(a.system)) return /Invoice/.test(a.text) ? "300" : "geen";
      if (/JSON-array/.test(a.system)) {
        // a path as the text names it ("acme/web#12/src/a.ts" when the review covers several PRs), the first PR's (the last one's for the third)
        const named = (path: string, last = false) => {
          const all = [...String(a.text).matchAll(new RegExp(`^--- (.*${path.replace(/[.]/g, "\\.")})$`, "gm"))];
          return (last ? all.at(-1) : all[0])?.[1] ?? path;
        };
        // Codex: one line Claude also flags, one of its own
        if (a.provider === "codex")
          return JSON.stringify([
            {
              path: named("src/auth/callback.ts"),
              line: 14,
              side: "RIGHT",
              severity: "bug",
              text: "returnTo is an unchecked redirect target; allow only same-origin paths.",
            },
            {
              path: named("src/auth/callback.ts"),
              line: 17,
              side: "RIGHT",
              severity: "question",
              text: "Should the user id come from the verified token instead of the query?",
            },
          ]);
        return JSON.stringify([
          {
            path: named("src/auth/callback.ts"),
            line: 14,
            side: "RIGHT",
            severity: "bug",
            text: "The return URL is read from the query without checking its host: an open redirect.",
          },
          {
            path: named("src/auth/callback.ts"),
            line: 18,
            side: "RIGHT",
            severity: "risk",
            text: "The session is written before the token is verified.",
          },
          {
            path: named("src/auth/session.ts", true),
            line: 5,
            side: "RIGHT",
            severity: "nit",
            text: "This helper name hides that it also clears the cookie.",
          },
        ]);
      }
      if (/twee of drie/.test(a.system))
        return "Yes, the VAT column is in\nViewers can't see invoices yet\nCan we call Thursday?";
      if (/gemarkeerde regel/.test(a.system))
        return "It stores where to go after the login. Without a host check any URL is accepted.";
      return "Hi Sofie,\n\nThe export has the VAT column since this morning, and viewers can't see invoices: that stays for admins.\n\nKind regards";
    case "github_pr_files":
      return [
        {
          path: "src/auth/callback.ts",
          status: "modified",
          additions: 6,
          deletions: 3,
          patch:
            "@@ -10,12 +10,15 @@ export async function callback(req: Request) {\n   const session = await getSession(req);\n   const params = new URL(req.url).searchParams;\n-  const back = '/';\n+  const back = params.get('returnTo') ?? '/';\n   if (!params.get('code')) return redirect('/login');\n-  await verify(params.get('code'));\n-  session.set('returnTo', back);\n+  session.set('returnTo', back);\n+  session.set('user', params.get('user'));\n+  await verify(params.get('code'));\n   return redirect(back);\n }\n+\n+export const loginUrl = () => '/login';",
        },
        {
          path: "src/auth/session.ts",
          status: "modified",
          additions: 3,
          deletions: 1,
          patch:
            "@@ -1,6 +1,8 @@\n import { cookies } from './cookies';\n \n-export const clear = () => cookies.delete('sid');\n+export const reset = () => {\n+  cookies.delete('sid');\n+};\n export const get = () => cookies.get('sid');",
        },
        { path: "assets/logo.png", status: "modified", additions: 0, deletions: 0, patch: null },
        // a long file with a very long line: the diff scrolls both ways
        {
          path: "src/long.ts",
          status: "added",
          additions: 120,
          deletions: 0,
          patch: `@@ -0,0 +1,120 @@\n${Array.from({ length: 120 }, (_, i) => (i === 3 ? `+export const query = "${"SELECT id, name, created_at FROM very_long_table_name ".repeat(6)}";` : `+export const line${i} = ${i};`)).join("\n")}`,
        },
      ];
    case "github_pr_review":
      return null;
    case "mail_move":
      // the backend refuses with the experimental flag off, and takes 1 to 500 mails at a time
      if (!settings.mail?.experimental)
        throw new Error("Archive and delete are experimental, switch them on in Settings › Mail");
      if (!a.ids?.length || a.ids.length > 500) throw new Error("1 to 500 mails at a time");
      for (const id of a.ids) movedMails.add(`${a.account}:${id}`);
      return null;
    case "mail_test":
      return "Connected: 1,204 mails in INBOX";
    case "mail_connect":
      return {
        account: { email: a.email, keychain_service: "relay-mail", keychain_account: a.email },
        result: "Connected",
      };
    // calendar: the secret address is checked like calendar.rs's url_ok, then "fetched" (3 meetings in the next 7 days)
    case "calendar_connect":
      if (!a.url) return 0;
      if (!a.url.startsWith("https://calendar.google.com/calendar/ical/") || !a.url.endsWith(".ics"))
        return Promise.reject(
          "That is no secret iCal address. In Google Calendar: Settings › your calendar › Integrate calendar › Secret address in iCal format.",
        );
      return 3;
    case "calendar_meetings": {
      const feeds: string[] = settings.calendar?.on
        ? settings.calendar.feeds.map((f: { email: string }) => f.email)
        : [];
      const day = fixture.startsWith("today-")
        ? integ.todayMeetings(fixture.replace(/^today-/, "").replace(/-dark$/, ""))
        : integ.meetings;
      return { meetings: feeds.length ? structuredClone(day) : [], errors: integ.calendarErrors(feeds) };
    }
    // plugins (src-tauri/src/plugins.rs): the one example server, a fixed die so the screenshots stay the same
    case "plugins_list":
      return Object.fromEntries(
        (settings.plugins ?? []).map((p: { id: string; secrets: string[] }) => [
          p.id,
          Object.fromEntries(p.secrets.map(name => [name, !!pluginSecrets.get(p.id)?.has(name)])),
        ]),
      );
    case "plugin_secret": {
      const set = pluginSecrets.get(a.id) ?? new Set<string>();
      if (a.value) set.add(a.name);
      else set.delete(a.name);
      pluginSecrets.set(a.id, set);
      return null;
    }
    case "plugin_forget":
      pluginSecrets.delete(a.id);
      return null;
    case "plugin_test":
      return { server: { name: "relay-example", version: "0.1.0" }, tools: diceTools, views: diceViews };
    case "plugin_view":
      return {
        url: URL.createObjectURL(new Blob([diceView], { type: "text/html" })),
        ...(diceViews.find(v => v.uri === a.uri) ?? diceViews[0]),
        prefersBorder: false,
        csp: { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] },
      };
    case "plugin_call": {
      const plugin = (settings.plugins ?? []).find((p: { id: string }) => p.id === a.id);
      if (!plugin?.allowed.includes(a.tool)) throw `The tool '${a.tool}' is not allowed for this plugin`;
      return {
        content: [{ type: "text", text: `Rolled 4 on a d${a.args?.sides ?? 6}` }],
        structuredContent: { value: 4, sides: a.args?.sides ?? 6 },
      };
    }
    case "plugin_import_list":
      return fixture.startsWith("plugins") ? ["garmin"] : [];
    case "plugin_import":
      return {
        id: "garmin",
        name: a.name,
        command: "uvx",
        args: ["garmin-mcp"],
        env: {},
        secrets: ["GARMIN_PASSWORD"],
        on: true,
        allowed: [],
        views: [],
      };
    case "integration_status":
    case "integration_has_token":
      return (
        a.provider === "productive" ||
        (fixture === "linear" && a.provider === "linear") ||
        (fixture === "buddy" && a.provider === "buddy")
      );
    case "integration_mcp":
      return { supported: a.provider === "productive", found: false };
    case "integration_token":
      return null;
    case "integration_call":
      if (fixture === "linear" && a.provider === "linear") return integ.linear(a.body);
      if (fixture === "buddy" && a.provider === "buddy") return integ.buddy(a.path);
      if (a.provider !== "productive") throw new Error(`${a.provider} is not set up in the harness`);
      return integ.productive(a.method, a.path, a.body);
    case "integration_upload":
      return "https://files.example/upload/1";
    case "open_viewer":
      return null;
    case "ticket_pictures":
      return (a.files as [string, string][]).map(([name]) => `/tmp/relay-ticket-pictures/1f2e-${name}`);
    case "integration_thumb":
      return a.url === integ.THUMB_URL ? thumb : Promise.reject("not a picture");
  }
  unmocked.add(cmd);
  console.warn(`[harness] unmocked command ${cmd}`, a);
  return null;
}

// ---------- ready: the first quiet 250 ms after the window's start-up calls (the polls do not count)
const POLLS = new Set([
  "pending",
  "subagents",
  "history_sid",
  "agents",
  "app_sids",
  "app_sessions",
  "running",
  "plugin:window|is_focused",
]);
let markReady: () => void;
const ready = new Promise<void>(resolve => (markReady = resolve));
let quietTimer = 0;
const settle = () => {
  clearTimeout(quietTimer);
  quietTimer = window.setTimeout(() => markReady(), 250);
};

mockWindows(query.get("window") || (isSettingsWindow ? "settings" : "main")); // ?window=main-2: a window Cmd-N opened
mockIPC((cmd, args) => {
  const a = (args ?? {}) as Args;
  calls.push({ cmd, args: a, at: performance.now() });
  if (!POLLS.has(cmd) && !cmd.startsWith("plugin:event|")) settle();
  return handle(cmd, a);
});
// the relay-file scheme of the backend (attach.rs) has no server here: a file's address is the picture or clip it stands for
internals().convertFileSrc = (path: string) => embeds.fileSrc(decodeURIComponent(path));
// a window that makes no call at all is ready too
setTimeout(settle, 0);

// ---------- streaming a turn: the agent events of the real sequence, one task per event like Tauri's
type StreamOpts = { key: string; deltas: number; tokensPerDelta?: number; ratePerSecond?: number; tools?: boolean };
type StreamStats = { perDelta: number[]; total: number; renderedAt: number };
const nextTask = () =>
  new Promise<void>(resolve => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(0);
  });
/** The next frame has been painted: a task right after the next animation frame. */
const nextPaint = () =>
  new Promise<number>(resolve => requestAnimationFrame(() => nextTask().then(() => resolve(performance.now()))));

async function stream({
  key,
  deltas,
  tokensPerDelta = 3,
  ratePerSecond = 0,
  tools = true,
}: StreamOpts): Promise<StreamStats> {
  const words = conv.replyText(deltas * tokensPerDelta);
  const perDelta: number[] = [];
  const start = performance.now();
  if (tools) {
    emitAgent(key, {
      type: "tool_call",
      id: `toolu_stream_${start | 0}`,
      name: "Read",
      input: { file_path: `${vault.VAULT}/Calendar/2026-10-01.md` },
    });
    await nextTask();
    emitAgent(key, { type: "tool_result", id: `toolu_stream_${start | 0}`, error: false });
    await nextTask();
  }
  for (let i = 0; i < deltas; i++) {
    if (ratePerSecond > 0) {
      const due = start + (i * 1000) / ratePerSecond;
      const wait = due - performance.now();
      if (wait > 1) await new Promise(resolve => setTimeout(resolve, wait));
    }
    const text = words.slice(i * tokensPerDelta, (i + 1) * tokensPerDelta).join("");
    const before = performance.now();
    emitAgent(key, { type: "text", text, delta: true });
    await nextTask(); // the handler and the microtasks it queued (a store notify, a render) have run
    perDelta.push(performance.now() - before);
  }
  emitAgent(key, {
    type: "turn_end",
    ok: true,
    error: null,
    usage: { input: 1200, output: deltas * tokensPerDelta, cacheRead: 0, cacheWrite: 0 },
    duration_ms: Math.round(performance.now() - start),
  });
  await nextTask();
  const renderedAt = await nextPaint();
  return { perDelta, total: renderedAt - start, renderedAt };
}

// the main vault's notes after the Pages tab's file operations (null: the fixture's), and what went into the trash
let pages: string[] | null = null;
const madeContexts: string[] = [];
const madeProjects: ReturnType<typeof vault.snapshot>["projects"] = [];
const states: Record<string, string> = {};
const repaired = new Set<string>();
const finding = (kind: string, context: string, path: string, paths: string[] = [], fix = true) => ({
  id: `${kind}:${context}:${path}`,
  kind,
  context,
  path,
  paths,
  fix,
});
// Tidy structure: the flat Calendar/'s notes by type, each with the folder its type goes in
const OUTSIDE: [string, string, string[]][] = [
  [
    "Meeting",
    "Calendar/Meetings/2026",
    [
      "2026-11-04 Northwind sync",
      "2026-10-28 Northwind sync",
      "2026-10-22 Atlas intake",
      "Old/2026-10-22 Atlas intake",
      "2026-10-15 Bluebird kickoff",
    ],
  ],
  ["Thread", "Calendar/Threads/2026", ["Atlas pricing question", "Bluebird brief"]],
  ["Daily", "Calendar/Daily/2026", ["2026-11-04", "2026-11-03", "2026-11-02"]],
];
const TIDY = {
  moves: OUTSIDE.flatMap(([kind, home, names]) =>
    names.map((n, i) => {
      const name = n.split("/").pop()!;
      const renamed = names.findIndex(o => o.split("/").pop() === name) !== i;
      return { kind, from: `Calendar/${n}.md`, to: `${home}/${name}${renamed ? " 2" : ""}.md`, renamed };
    }),
  ),
  stay: 4,
  links: 12,
  notes: 7,
};
let tidied = false;
// the garden: one of each problem, gone when acted on (a project picked, a note fixed, a file trashed)
const MEETINGS_WITHOUT_PROJECT = [
  "Calendar/Meetings/2026/2026-10-30 Call Sofie planning Q1.md",
  "Calendar/Meetings/2026/2026-10-22 Intake Atlas sorting line.md",
  "Calendar/Meetings/2026/2026-10-14 Bluebird check-in.md",
];
const GARDEN_TYPELESS = [
  "Resources/Notes/Pricing ideas.md",
  "Resources/Notes/Warehouse layout.md",
  "Inbox/Call notes.md",
];
const UNUSED = [
  "Attachments/2026/floor-plan-v1.png",
  "Attachments/2026/scan-0042.pdf",
  "Attachments/2026/old-logo.svg",
];
const gardenDone = new Set<string>();
const aboutSet: [string, string][] = []; // garden_about calls, for the checks
const gardenFindings = () => {
  const left = (paths: string[]) => paths.filter(p => !gardenDone.has(p) && !trashed.has(p));
  const f = (kind: string, paths: string[], context = "") =>
    paths.length ? [finding(kind, context, "", paths, false)] : [];
  return [
    ...OUTSIDE.map(([kind, , names]) =>
      finding(
        "outside_home",
        "",
        kind,
        names.map(n => `Calendar/${n}.md`),
        false,
      ),
    ).filter(() => !tidied),
    ...f("no_project", left(MEETINGS_WITHOUT_PROJECT)),
    ...f("broken_link", [
      "Contexts/Agency/Projects/Northwind Portal/Northwind Portal.md\t12\tPricewise API",
      "Resources/Notes/Pricing ideas.md\t3\tOld offer",
    ]),
    ...f("orphan", [
      "Resources/Notes/Warehouse layout.md",
      "Resources/Notes/Old idea.md",
      "Inbox/Scratch.md",
      "Resources/Notes/Parking.md",
    ]),
    ...f("unused_attachment", left(UNUSED), String(4_300_000)),
    ...f("no_type", left(GARDEN_TYPELESS)),
  ];
};
// one of every health kind (issue 425)
const VAULT_FINDINGS = [
  finding("claude_link", "", ".claude"),
  finding("missing_file", "", "System/rules/core/team.md"),
  finding("context_note", "Studio", "Contexts/Studio/Studio.md"),
  finding("context_heading", "Studio", "Contexts/Personal/State/work-state.md"),
  finding("orphan_rule", "", "System/rules/gone/context.md", ["Contexts/Gone"], false),
  finding("context_rule", "Agency", "System/rules/agency/context.md"),
  finding("card_fields", "Agency", "Contexts/Agency/Projects/Beacon Billing/Beacon Billing.md", ["status", "last"]),
  finding("row_without_note", "Agency", "Old Lead", [], false),
  finding("context_mismatch", "Studio", "Contexts/Studio", [
    "Contexts/Studio/Projects/Side Studio/Documents/Brief.md",
    "Contexts/Studio/People/Ana.md",
  ]),
];
const trashed = new Map<string, string[]>();
// fixture linked: notes outside the projects' folders that point at them (about:, context:, with:)
const linkedOn = fixture.startsWith("linked");
// fixture embeds (K4): the Northwind Portal page holds a picture, a PDF, an audio file and a section of another note
const embedsOn = fixture.startsWith("embeds");
// fixture linked-views (issue 421): the Northwind Portal page holds views inside it (Obsidian bases)
const viewsOn = fixture.startsWith("linked-views");
// fixture kb (K5, K1): notes with content to search, templates, favourites
const kbOn = fixture.startsWith("kb");
const changesOn = fixture.startsWith("kb-changes");
// kb-sketch (-dark): the same notes without a feed, and the one note that has no type: (Fix properties)
// kb-unsorted: the sketch and a dozen more notes without a type, for the Pages tab's Unsorted (issue 420)
const unsortedOn = fixture.startsWith("kb-unsorted");
const unsortedPaths = unsortedOn ? Array.from({ length: 12 }, (_, i) => `Inbox/Loose note ${i + 1}.md`) : [];
const sketchOn = changesOn || fixture.startsWith("kb-sketch") || unsortedOn;
// kb-tables (-dark): one more note, holding the tables the table editing is tried on
const tablesOn = fixture.startsWith("kb-tables");
const keepState = query.get("keep") === "1";
let favourites: string[] = keepState ? JSON.parse(sessionStorage.getItem("mockFavourites") || "[]") : [];
if (!keepState) for (const k of Object.keys(sessionStorage)) if (k.startsWith("mock")) sessionStorage.removeItem(k);
const pageList = () =>
  pages ??
  (kbOn
    ? [
        ...vault.notes,
        ...kb.paths,
        ...(sketchOn ? [kb.untyped.path] : []),
        ...unsortedPaths,
        ...(tablesOn ? [kb.tables.path] : []),
        ...(inboxOn ? inbox.paths : []),
      ]
    : linkedOn
      ? [...vault.notes.filter(n => vault.flat(n)), vault.FLAT_NOTE, ...vault.linkedPaths]
      : embedsOn
        ? [...vault.notes, embeds.FINDINGS_NOTE]
        : vault.notes);
// the saved collection views, kept over a reload with ?keep=1 like the favourites
let viewsMem: { name: string; view: unknown }[] = keepState
  ? JSON.parse(sessionStorage.getItem("mockViews") || "[]")
  : [];
const savedViews = () => viewsMem;
const keptViews = (list: { name: string; view: unknown }[]) => {
  viewsMem = list;
  if (keepState) sessionStorage.setItem("mockViews", JSON.stringify(list));
};
// a note's text: what was written, else the fixture's own (collections.ts), else the generic note
const textOfNote = (path: string): string =>
  written.get(path)?.text ?? coll.texts[path] ?? String(vault.noteText(path).text);
/** The index's row for a note (related.rs `collection`): its type, date, stage and every frontmatter key's values. */
function collectionRow(path: string, text: string) {
  const head = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
  const props: Record<string, string[]> = {};
  const lines = head.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^([^\s#\-][^:]*):(.*)$/.exec(lines[i]);
    if (!m) continue;
    const raw = [m[2].trim()];
    while (i + 1 < lines.length && /^(\s+|- )/.test(lines[i + 1])) raw.push(lines[++i].trim().replace(/^- /, ""));
    const values = raw
      .flatMap(r =>
        r.includes("[[") ? [...r.matchAll(/\[\[([^\]|#]+)/g)].map(x => x[1].trim()) : [r.replace(/^["']|["']$/g, "")],
      )
      .filter(Boolean);
    if (values.length) props[m[1].trim()] = values;
  }
  const body = text.slice(text.indexOf("\n---", 3) + 4);
  const kind = props.type?.[0] ?? "";
  const stem = path.split("/").pop()!.replace(/\.md$/, "");
  const date = props.date?.[0] ?? (/^\d{4}-\d\d-\d\d/.test(stem) ? stem.slice(0, 10) : "");
  const stage =
    kind.toLowerCase() !== "meeting"
      ? ""
      : /^## Summary\s*$/m.test(body)
        ? "wrapped"
        : /\n## Briefing\n[^\n#]*\S/.test(`\n${body}`)
          ? "briefed"
          : "planned";
  const links = [...text.matchAll(/\[\[([^\]|#\n]+)/g)].map(x => x[1].trim());
  return {
    p: path,
    t: stem,
    k: kind,
    at: Math.floor(NOW_S - 3 * 86400),
    date,
    stage,
    props,
    links,
    tags: props.tags ?? [],
  };
}
const pageRel = (p: unknown) => String(p).replace(vault.VAULT, "").replace(/^\//, "");
// shared-live: the Mac's document of the page, which the editor and the mock peers share, and the cursors sent
const liveDoc = new Y.Doc();
const liveCursors: string[] = [];
const b64 = (u: Uint8Array) => btoa(Array.from(u, b => String.fromCharCode(b)).join(""));
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
// the index just after `after` in the document's text (its end when not found)
const liveAt = (after: string) => {
  const text = liveDoc.getText("md").toString();
  const i = text.indexOf(after);
  return i < 0 ? text.length : i + after.length;
};
// the page editor's saves (write_note), and whether a note changed on disk since it was read
type Comment = {
  id: string;
  by: string;
  mine: boolean;
  k: string;
  on?: string;
  t?: string;
  q?: string;
  a?: unknown;
  m?: string[]; // members mentioned (ticket 12)
  at: number;
};
const comments = new Map<string, Comment[]>(); // a page's comment entries (ticket 11), by its path
// ticket 12: pages read as a team workspace's documents (members to mention, an Inbox), set with __harness.teamComments
let teamComments = false;
// a workspace without history (K1b): its documents' history, comments and cursors name no one, set with
// __harness.anonymousDocs
let anonymousDocs = false;
const unnamed = <T extends { by: string }>(c: T) => ({ ...c, by: "" });
const ME = "aaaaaaaaaaaaaaaa";
const MEMBERS = [
  { fp: "bbbbbbbbbbbbbbbb", name: "Ben Lauwers" },
  { fp: "cccccccccccccccc", name: "Ana Vos" },
];
/** A page's comments are kept by its path in its workspace (the same note opened from the Inbox in another one). */
const commentKey = (path: unknown) => String(path).replace(/^\/Users\/me\/(Shared\/Northwind|Vault)\//, "");
/** A page's threads from its entries, as comments.rs makes them. */
function threadsOf(all: Comment[]) {
  const gone = new Set(all.filter(e => e.k === "delete" && all.find(t => t.id === e.on)?.by === e.by).map(e => e.on));
  const item = (e: Comment) => ({ id: e.id, by: e.by, mine: e.mine, at: e.at, text: e.t ?? "" });
  return all
    .filter(e => e.k === "comment" && !gone.has(e.id))
    .map(e => {
      const last = all.filter(x => x.on === e.id && (x.k === "resolve" || x.k === "reopen")).pop();
      const replies = all.filter(x => x.k === "reply" && x.on === e.id && !gone.has(x.id));
      return {
        ...item(e),
        quote: e.q,
        anchor: e.a,
        resolved: last?.k === "resolve",
        replies: replies.map(item),
        mentionsMe: [e, ...replies].some(x => x.m?.includes(ME)),
      };
    });
}

const written = new Map<string, { text: string; hash: string }>(
  fixture.startsWith("linked-collections") || viewsOn
    ? Object.entries(viewsOn ? views.texts : coll.texts).map(([path, text]) => [path, { text, hash: "h0" }])
    : embedsOn
      ? Object.entries(embeds.texts).map(([path, text]) => [path, { text, hash: "h0" }])
      : kbOn
        ? [...Object.entries(kb.texts), ...(inboxOn ? Object.entries(inbox.texts) : [])].map(([path, text]) => [
            path,
            { text, hash: "h0" },
          ])
        : [],
);
// the Changes feed (K6, issue 371): the real one is src-tauri/src/changes.rs, which has its own tests. Kept in memory.
type Change = {
  id: string;
  at: number;
  source: string;
  subject: string;
  reason: string;
  files: { path: string; before: string | null; after: string | null; state: string }[];
};
let changes: Change[] = changesOn ? kb.seedChanges(fixture.startsWith("kb-changes-long")) : [];
if (sketchOn) written.set(kb.untyped.path, { text: kb.untyped.text, hash: "h0" });
for (const path of unsortedPaths) written.set(path, { text: "Jotted down, no type yet.\n", hash: "h0" });
if (tablesOn) written.set(kb.tables.path, { text: kb.tables.text, hash: "h0" });
if (changesOn) {
  for (const e of changes)
    for (const f of e.files) if (f.after !== null) written.set(f.path, { text: f.after, hash: "h0" });
}
const noteKey = (path: string) => [...written.keys()].find(k => k === path || k.endsWith(`/${path}`)) ?? path;
const noteNow = (path: string) => written.get(noteKey(path))?.text ?? null;
const putNote = (path: string, text: string | null) => {
  if (text === null) written.delete(noteKey(path));
  else written.set(noteKey(path), { text, hash: `h${++writes}` });
};
/** A job's writes as one entry, as changes.rs records them: the notes that differ from `before`. */
function recordChange(source: string, subject: string, reason: string, edits: [string, string | null][]) {
  const files = edits
    .map(([path, after]) => ({ path, before: noteNow(path), after, state: "open" }))
    .filter(f => f.before !== f.after);
  for (const f of files) putNote(f.path, f.after);
  if (!files.length) return;
  changes = [{ id: `${Date.now()}-${changes.length}`, at: Date.now(), source, subject, reason, files }, ...changes];
  emit("changes-changed", null);
}
/** What Claude does for a page action here, in a line each: enough to show the result in the feed. */
function mockAction(action: string, path: string, selection: string | null): [string, [string, string | null][]] {
  const text = noteNow(path) ?? "";
  if (action === "properties") {
    const has = /^---\n[\s\S]*?\btype:/.test(text);
    const next = has
      ? text
      : /^---\n/.test(text)
        ? text.replace("---\n", "---\ntype: Document\n")
        : `---\ntype: Document\ncontext: "[[Agency]]"\n---\n${text}`;
    return [has ? "Nothing to change" : "Added type: Document and context: Agency", [[path, next]]];
  }
  if (action === "about") {
    const next = /^---\n/.test(text) ? text.replace("---\n", '---\nabout: "[[Northwind Portal]]"\n') : text;
    return ["Set about: Northwind Portal", [[path, next]]];
  }
  if (action === "summarise") {
    const at = text.indexOf("\n", text.indexOf("# ")) + 1;
    const about = selection ? "the selected text" : "the note";
    return [
      `Summarised ${about} in a Summary section`,
      [[path, `${text.slice(0, at)}\n## Summary\nA short summary of ${about}.\n${text.slice(at)}`]],
    ];
  }
  return [`Ran ${action}`, [[path, `${text}\n<!-- ${action} -->\n`]]];
}
// the files added to a page (attach_copy, attach_save), for the checks
const attached: { page: string; name: string; bytes?: number }[] = [];
const eventNotes = new Map<string, string>(); // a calendar event's id -> the note that holds it (`event:`)
let writes = 0;
let diskChanged = false;
let followupMode: "ok" | "slow" | "fail" = "ok"; // the same for the follow-up mail
let wrapupMode: "ok" | "slow" | "fail" = "ok"; // what a meeting's wrap-up draft does (ai_write)
let lastSaved = ""; // the page write_note saved last, which __harness.written gives
let lastPage = ""; // the page read_note last read, which __harness.editOutside changes
// Tauri gives a drop's position in physical pixels; the harness is given the page's own
const physical = (at: { x: number; y: number }) => ({ x: at.x * devicePixelRatio, y: at.y * devicePixelRatio });
const harness = {
  // the app has asked for the orchestrator's workers (orchestrator-closed-empty waits for it)
  workersRead: false,
  ready,
  calls,
  unmocked,
  autoReply: true,
  echo: true,
  /** What `pick_folder` answers: null is cancelled. */
  pickFolder: null as string | null,
  /** What `pick_files` answers (the + button's dialog): [] is cancelled. */
  pickFiles: [] as string[],
  /** What `pasted_files` answers: the paths of files copied in Finder. */
  pastedFiles: [] as string[],
  fixture,
  now: NOW,
  keys: {
    long: conv.LONG_KEY,
    switchTo: conv.SWITCH_KEY,
    permission: conv.PERMISSION_KEY,
    question: conv.QUESTION_KEY,
    action: conv.ACTION_KEY,
    orch: orch.ORCH,
    orchWorker: orch.workers[1].key,
    terminal: `t:${vault.terminalSessions[0].sessionId}`,
  },
  titles: {
    long: conv.LONG_TITLE,
    switchTo: conv.SWITCH_TITLE,
    permission: conv.PERMISSION_TITLE,
    question: conv.QUESTION_TITLE,
    action: conv.ACTION_TITLE,
  },
  markers: {
    longEnd: conv.LONG_END,
    switchEnd: conv.endMarker(conv.SWITCH_KEY),
    card: integ.CARD_TITLE,
    plainMail: integ.PLAIN_MAIL.subject,
    htmlMail: integ.HTML_MAIL.subject,
    studioMail: integ.STUDIO_MAIL.subject,
    otherMail: integ.OTHER_MAIL.subject,
    orchReport: orch.REPORT_MARKER,
  },
  emit,
  emitAgent,
  stream,
  nextTask,
  nextPaint,
  /** a meeting recording's quarter-second tick: the time and both levels (0..1) */
  recordingTick: (secs: number, me = 0.3, others = 0.2, extra: Record<string, unknown> = {}) =>
    meetingTicks && sendTo(meetingTicks.channel, meetingTicks.index++, { secs, me, others, ...extra }),
  /** the composer's dictation hearing something */
  dictationLevel: (level: number) => dictationLevels && sendTo(dictationLevels.channel, dictationLevels.index++, level),
  /** a setting changed in the Settings window: saved, and the main window told (settings-changed) */
  changeSettings: (patch: Record<string, unknown>) => {
    settings = { ...settings, ...structuredClone(patch) };
    emit("settings-changed", structuredClone(settings));
  },
  /** a relay:// link while the app runs (Raycast, a browser), as the deep-link plugin delivers it */
  deepLink: (url: string) => emit("deep-link://new-url", [url]),
  /** a permission card that turns up in the next `pending` poll */
  addPending: (request: (typeof pending)[number]) => void pending.push(request),
  /** files dragged in from Finder: Tauri's drag-enter, then drag-drop with the paths (the webview's onDragDropEvent) */
  dropPaths: async (paths: string[], at = { x: 400, y: 300 }) => {
    const position = physical(at);
    emit("tauri://drag-enter", { paths, position });
    await nextTask();
    emit("tauri://drag-drop", { paths, position });
    await nextTask();
  },
  /** files hovering over the window at `position` (the drop's insertion line shows), not dropped yet */
  dropHover: async (paths: string[], at = { x: 400, y: 300 }) => {
    const position = physical(at);
    emit("tauri://drag-enter", { paths, position });
    await nextTask();
    emit("tauri://drag-over", { position });
    await nextTask();
  },
  /** the files added to a page so far (attach_copy, attach_save) */
  attached: () => structuredClone(attached),
  aboutSet: () => structuredClone(aboutSet),
  /** what a fresh session ran on when the model and effort were left to the CLI (read_agent's `resolved`) */
  resolved: (key: string, model = "opus", effort = "high") =>
    emitAgent(key, { type: "resolved", model, effort, default_model: true, default_effort: true }),
  /** the live events after the long conversation opened: running and failed tools, an error, a draft note */
  liveTail: (key = conv.LONG_KEY) => conv.liveTail().forEach(event => emitAgent(key, event)),
  /** how a meeting's wrap-up draft goes: written, never finishing (the skeleton), or failing */
  wrapupMode: (mode: "ok" | "slow" | "fail") => void (wrapupMode = mode),
  followupMode: (mode: "ok" | "slow" | "fail") => void (followupMode = mode),
  /** a capture run finished (what capture_vault does): two notes edited, one entry in the Changes feed */
  capture: () =>
    recordChange(
      "capture",
      kb.capture.subject,
      kb.capture.reason,
      kb.capture.files.map(f => [f.path, f.after]),
    ),
  /** a note's text now, as the backend has it (a page's saves and a job's writes) */
  noteText: (path: string) => noteNow(path),
  /** a note's text typed by the user outside the editor flow: what an Undo finds when the note was edited since the run */
  typeInto: (path: string, text: string) => putNote(path, text),
  /** a note in the vault with this text (a project's, with its decisions) */
  setNote: (path: string, text: string) => void written.set(path, { text, hash: `h${++writes}` }),
  /** a meeting note in the vault: its text, found by the event it belongs to */
  meetingNote: (event: string, path: string, text: string) => {
    written.set(path, { text, hash: `h${++writes}` });
    eventNotes.set(event, path);
  },
  /** what the page editor saved last (write_note) */
  written: () => (lastSaved ? written.get(lastSaved)?.text : [...written.values()].pop()?.text) ?? null,
  /** someone changed a note on disk: the next save without force is refused */
  changeOnDisk: () => void (diskChanged = true),
  teamComments: () => void (teamComments = true),
  anonymousDocs: () => void (anonymousDocs = true),
  // the page last read changed outside Relay: its text through `edit`, then the file watcher's event (watch.rs)
  editOutside: (find: string, put: string) => {
    const now = written.get(lastPage)?.text ?? vault.noteText(lastPage).text;
    const hash = `h${++writes}`;
    written.set(lastPage, { text: now.replace(find, put), hash });
    emit("note-changed", { path: lastPage, hash, relinked: false });
  },
  /** shared-live: a peer types `put` after `after` in the page's document (as another member's update reaches it) */
  peerType: (after: string, put: string) => {
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(liveDoc));
    const before = Y.encodeStateVector(peer);
    peer.getText("md").insert(liveAt(after), put);
    const update = Y.encodeStateAsUpdate(peer, before);
    Y.applyUpdate(liveDoc, update, "peer");
    emit("shared-doc", { vault: "v1", id: "d1", update: b64(update) });
  },
  /** shared-live: a peer's cursor (from: their device) after `after`, selecting `select` characters before it */
  peerCursor: (from: string, name: string, after: string, select = 0) => {
    const text = liveDoc.getText("md");
    const pos = (i: number) => Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(text, i));
    const head = liveAt(after);
    const body = JSON.stringify({ name, anchor: pos(head - select), head: pos(head) });
    emit("shared-awareness", { vault: "v1", doc: "d1", from, body });
  },
  /** shared-live: the page's document as the Mac holds it now, and the cursors the editor sent */
  liveText: () => liveDoc.getText("md").toString(),
  liveCursors: () => [...liveCursors],
  /** the board pipeline's calls so far */
  pipelineCalls: () => structuredClone(pipelineCalls),
  /** what gh says about the pipeline's PRs from now on */
  setPr: (status: Record<string, unknown>) =>
    void (prStatus = { state: "OPEN", reviewDecision: null, reviews: [], comments: [], inline: [], ...status }),
  /** a pipeline worker reports: its state, its PR (what orch.rs sets after the push), the `orch` event */
  pipelineReport: (key: string, status: string, pr: string | null, extra: Record<string, unknown> = {}) => {
    const worker = workers.find(w => w.key === key);
    if (!worker) return false;
    Object.assign(worker, {
      state: status,
      ended: Date.now(),
      pr,
      report: { status, summary: "Built it.", questions: null, diff: null, flags: [] },
      ...extra,
    });
    emit("orch", { type: "worker", worker: structuredClone(worker) });
    return true;
  },
  /** the backend's stall watch marks the running worker (fixture "orch"): a card nobody answered */
  orchStuck: () => {
    const worker = workers.find(w => w.state === "running");
    if (!worker) return;
    Object.assign(worker, { stalled: "waits on a permission card for Bash since 09:12" });
    emit("orch", { type: "worker", worker: structuredClone(worker) });
  },
  /** the orchestrator's live events (fixture "orch"): a worker starts, another reports into the coordinator, one task each */
  orchLive: async () => {
    for (const event of orch.live()) {
      if (event.type === "worker") {
        const worker = event.worker as orch.Worker;
        workers = [...workers.filter(w => w.key !== worker.key), worker];
      }
      emit("orch", event);
      await nextTask();
    }
  },
  /** Settings › General › Experimental › Files switched (fixture "files-off"), as the settings window's save emits it */
  setFiles: (files: boolean) => {
    settings = { ...settings, experimental: { ...settings.experimental, files } };
    emit("settings-changed", structuredClone(settings));
  },
};
(window as any).__harness = harness;
export type Harness = typeof harness;
