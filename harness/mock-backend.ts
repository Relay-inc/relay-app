// The Tauri backend, mocked at the IPC boundary: every command the frontend invokes, the event plugin, the window.
// Loaded as the first script of index.html and settings.html (harness/vite.config.ts), before the app's entry.
// Nothing here knows the app's internals: it answers commands with the shapes src-tauri/src/*.rs returns and emits the
// events the backend emits. Query: ?fixture=default|dark|graphite|icons|onboarding|calendar|accounts|mailexp|machines|phone|mirror|orch|brain|plugins|plugins-dark, ?sel=<selection key> (what the window
// opens on), ?link=<relay:// url> (the deep link the app was launched with), ?window=<label> (main-2: a window Cmd-N opened).
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { NOW, pngBase64 } from "./fixtures/util";
import * as vault from "./fixtures/vault";
import * as conv from "./fixtures/conversations";
import * as integ from "./fixtures/integrations";
import * as orch from "./fixtures/orchestrator";
import * as brain from "./fixtures/brain";
import * as git from "./fixtures/git";
import * as files from "./fixtures/files";
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
const shared = fixture === "shared";
if (shared) settings = { ...settings, extraVaults: [vault.TEAM_VAULT] };
let vaultOk = !onboarding;
let pending = [...conv.pending];
const gitRepos = structuredClone(git.repos);
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
const phoneShared = new Set<string>(); // conversation keys shared with the phone (/share-phone)
// the orchestrator's workers (fixture "orch"), changed by orch_stop
const orchOn = fixture === "orch" || fixture === "orch-plain" || fixture === "orch-empty" || fixture === "orch-closed";
// orch-empty: the orchestrator before its first task, no workers and an empty conversation
const orchEmpty = fixture === "orch-empty";
// orch-closed: an empty conversation, and workers the backend still reports whose conversations were all closed
const orchClosed = fixture === "orch-closed";
// Commonwealth installed, with one brain (the Brain view's tabs)
const brainOn = fixture === "brain";
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
const PROMPT = "kristof@mac ~/vault % ";
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
    // work machines (fixture "machines": one that speaks an older protocol; "phone": the same one online)
    case "machine_status":
      if (fixture === "phone" || fixture === "mirror")
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
    case "machines_list":
      return fixture === "github" ? [{ id: "a1b2c3d4e5f6", name: "Server", online: true, default: false }] : [];
    // fixture "github": the Harbor CRM conversation that asks a question runs on Server
    case "chat_machines":
      return fixture === "github"
        ? { [conv.QUESTION_KEY]: { machine: "Server", id: "a1b2c3d4e5f6", cwd: "/home/relay/vault" } }
        : {};

    // settings, language, vault
    case "get_settings":
      return structuredClone(settings);
    case "set_settings":
      settings = structuredClone(a.settings);
      if (settings.vault) vaultOk = true;
      return structuredClone(settings);
    case "ui_lang":
      return settings.language === "system" || !settings.language ? "en" : settings.language;
    case "ui_locale":
      return "en-GB";
    case "vault_status":
      return vault.vaultStatus(vaultOk);
    case "extra_vaults_status":
      return harness.extraVaults ?? [];
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
    case "open_file":
      return String(a.path).includes("missing") ? Promise.reject("not found") : null;
    case "snapshot": {
      const snap = vault.snapshot(reminders);
      if (!shared) return snap;
      const own = snap.projects.map(p => ({ ...p, vault: vault.VAULT }));
      return { ...snap, projects: [...own, ...vault.teamProjects], extraVaults: vault.teamStatus };
    }
    case "vault_notes":
      return { root: vault.VAULT, notes: vault.notes };
    case "read_note":
      return vault.noteText(a.target);
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
    case "reset":
    case "move_chat":
      return null;
    case "usage_limits":
      return integ.usageLimits;
    case "usage_tokens":
      return integ.usageTokens();

    // Commonwealth, the team brain: not installed, except in fixture "brain" (one brain, two staged notes)
    case "commonwealth_status":
      return {
        plugin: brainOn,
        cli: brainOn ? "/usr/local/bin/commonwealth" : null,
        hint: "npm i -g @cmnwlth/cli",
        projects: brainOn ? [{ project: "Northwind Portal", brain: brain.BRAIN, name: "team-brain" }] : [],
      };
    case "commonwealth_notes":
      return brainOn
        ? ["Retry only idempotent export calls", "Deploys go through the staging gate"].map((title, i) => ({
            brain: brain.BRAIN,
            id: `2026-09-30-staged-${i + 1}`,
            kind: i ? "decision" : "memory",
            title,
            created: "2026-09-30",
            author: "Laurent",
            source: "northwind-portal",
            body: `${title}. Learned while fixing the export job.`,
          }))
        : [];
    case "commonwealth_act":
      return null;
    case "commonwealth_join":
      return [
        `Brain: /Users/you/.commonwealth/brains/${String(a.remote).replace(/^.*[:/]([^/]+)\/([^/]+?)(\.git)?$/, "$1-$2")} (cloned)`,
        "  org:northwind/*  → this brain",
        "Next: install the plugin (`claude plugin install commonwealth@commonwealth`) and start a new session.",
      ].join("\n");

    // the Brain view: the vault, and the team brain in fixture "brain"
    case "brain_roots":
      return brain.roots(brainOn);
    case "brain_graph":
      return brain.graph(a.root);
    case "brain_search":
      return brain.search(a.root, a.query);
    case "brain_note":
      return brain.note(a.root, a.path);
    case "brain_touches":
      return brain.touches();

    // GitHub, mail, boards
    case "github_status":
      return "laurent";
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
      return { meetings: feeds.length ? structuredClone(integ.meetings) : [], errors: integ.calendarErrors(feeds) };
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
      return a.provider === "productive";
    case "integration_mcp":
      return { supported: a.provider === "productive", found: false };
    case "integration_token":
      return null;
    case "integration_call":
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

const harness = {
  // the app has asked for the orchestrator's workers (orchestrator-closed-empty waits for it)
  workersRead: false,
  ready,
  calls,
  unmocked,
  autoReply: true,
  echo: true,
  /** What `extra_vaults_status` answers: the shared vaults as the last snapshot read them. */
  extraVaults: (shared ? vault.teamStatus : []) as { vault: string; renamed: string[]; error: string | null }[],
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
  recordingTick: (secs: number, me = 0.3, others = 0.2) =>
    meetingTicks && sendTo(meetingTicks.channel, meetingTicks.index++, { secs, me, others }),
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
  dropPaths: async (paths: string[]) => {
    const position = { x: 400, y: 300 };
    emit("tauri://drag-enter", { paths, position });
    await nextTask();
    emit("tauri://drag-drop", { paths, position });
    await nextTask();
  },
  /** what a fresh session ran on when the model and effort were left to the CLI (read_agent's `resolved`) */
  resolved: (key: string, model = "opus", effort = "high") =>
    emitAgent(key, { type: "resolved", model, effort, default_model: true, default_effort: true }),
  /** the live events after the long conversation opened: running and failed tools, an error, a draft note */
  liveTail: (key = conv.LONG_KEY) => conv.liveTail().forEach(event => emitAgent(key, event)),
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
};
(window as any).__harness = harness;
export type Harness = typeof harness;
