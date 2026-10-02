// The Tauri backend, mocked at the IPC boundary: every command the frontend invokes, the event plugin, the window.
// Loaded as the first script of index.html and settings.html (harness/vite.config.ts), before the app's entry.
// Nothing here knows the app's internals: it answers commands with the shapes src-tauri/src/*.rs returns and emits the
// events the backend emits. Query: ?fixture=default|dark|graphite|icons|onboarding, ?sel=<selection key> (what the window
// opens on), ?link=<relay:// url> (the deep link the app was launched with).
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { NOW, pngBase64 } from "./fixtures/util";
import * as vault from "./fixtures/vault";
import * as conv from "./fixtures/conversations";
import * as integ from "./fixtures/integrations";

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
let vaultOk = !onboarding;
let pending = [...conv.pending];
let reminders = [...vault.reminders];
let added = 0;
let actionConfig = integ.actionConfig();

// ---------- the event plugin: listeners by event, emitted synchronously (a real Tauri event is one task per event)
const listeners = new Map<string, Set<number>>();
const internals = () => (window as any).__TAURI_INTERNALS__;
function emit(event: string, payload: unknown) {
  for (const id of [...(listeners.get(event) || [])]) internals().runCallback(id, { event, id, payload });
}
const emitAgent = (project: string, event: unknown, provider = "claude") => emit("agent", { project, provider, event });

// ---------- commands
const thumb = `data:image/png;base64,${pngBase64(100, 100, "#dfe7f7", "#2f6fdb")}`;
const calls: Call[] = [];
const unmocked = new Set<string>();
const sidKeys = () => Object.fromEntries(conv.conversations.map(c => [c.key, { provider: c.provider, sid: conv.sidOf(c.key) }]));
const terminalAgents = () => [
  ...vault.terminalSessions.map((s, i) => ({ id: `term-${i + 1}`, sessionId: s.sessionId, provider: "claude", kind: "interactive", status: i === 0 ? "busy" : "idle", name: s.name, startedAt: s.last_at })),
  vault.backgroundBlocked,
];

function handle(cmd: string, a: Args): unknown {
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
    case "plugin:window|set_title":
    case "plugin:opener|open_url":
      return null;
    // the deep-link plugin: the link the app was started with (later ones come as the deep-link://new-url event)
    case "plugin:deep-link|get_current":
      return query.get("link") ? [query.get("link")] : null;

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
    case "detect_vault":
    case "check_vault":
      return { ...vault.vaultStatus(true), vault: a.path, ...(a.map ? { map: a.map } : {}) };
    case "pick_folder":
    case "pick_path":
      return null;
    case "snapshot":
      return vault.snapshot(reminders);
    case "vault_notes":
      return { root: vault.VAULT, notes: vault.notes };
    case "read_note":
      return vault.noteText(a.target);
    case "project_icons":
      return vault.projectIcons();
    case "project_repos":
      return vault.projectRepos;
    case "favicons":
    case "find_icon_sites":
    case "integration_import":
      return {};
    case "set_project_icon":
    case "set_project_repos":
      return null;
    case "reminder":
      reminders = vault.remindersAfter(reminders, a.action, a, 0);
      return reminders.find(r => r.id === a.id)?.date ?? "";
    case "reminder_add":
      reminders = vault.remindersAfter(reminders, "add", a, ++added);
      return reminders.at(-1)!.id;

    // agents and conversations
    case "agents_status":
      return integ.agentsStatus;
    case "agent_commands":
      return integ.agentCommands(a.provider);
    case "action_config":
      return { actions: integ.actions, config: structuredClone(actionConfig) };
    case "set_action_config":
      if (Object.keys(a.entry).length) actionConfig[a.ext] = a.entry;
      else delete actionConfig[a.ext];
      return structuredClone(actionConfig);
    case "chats":
      return conv.conversations.map(c => c.key);
    case "chat_providers":
      return Object.fromEntries(conv.conversations.map(c => [c.key, c.provider]));
    case "app_sids":
      return conv.conversations.map(c => conv.sidOf(c.key));
    case "app_sessions":
      return sidKeys();
    case "agents":
      return terminalAgents();
    case "running":
      return {}; // conversation key -> turns running, for the processes the app started
    case "drop_worktrees":
      // the switch-to conversation made one git worktree, removed when it closes
      return a.project === conv.SWITCH_KEY ? { removed: 1, kept: 0 } : { removed: 0, kept: 0 };
    case "history":
      return conv.history(a.project);
    case "history_sid": {
      const items = conv.terminalHistory(a.sid);
      return (a.from ?? 0) === 0 ? { items, next: items.length ? 4096 : 0 } : { items: [], next: a.from };
    }
    case "subagents":
      return Object.fromEntries((a.keys as string[]).filter(k => k in conv.subagents).map(k => [k, conv.subagents[k as keyof typeof conv.subagents]]));
    case "agent_log":
      return conv.agentLog(a.id);
    case "pending":
      return pending;
    case "answer":
      pending = pending.filter(x => x.id !== a.id);
      return null;
    case "send":
      if (harness.autoReply) setTimeout(() => harness.stream({ key: a.project, deltas: 40, tokensPerDelta: 3, ratePerSecond: 60 }), 30);
      return null;
    case "ai_title":
      return String(a.text).split(/\s+/).slice(0, 5).join(" ");
    case "stop":
    case "bg":
    case "open_terminal":
    case "notify":
    case "open_settings_window":
    case "reset":
    case "move_chat":
      return null;
    case "usage_limits":
      return integ.usageLimits;
    case "usage_tokens":
      return integ.usageTokens();

    // GitHub, mail, boards
    case "github_status":
      return "laurent";
    case "github_prs":
      return integ.prs;
    case "github_pr":
      return integ.prDetail(a.repo, a.number);
    case "mail_list":
      return integ.mailPage(a.account, a.page ?? 1);
    case "mail_read":
      return integ.mailBody(a.id);
    case "mail_seen":
      return null;
    case "mail_test":
      return "Connected: 1,204 mails in INBOX";
    case "mail_connect":
      return { account: { email: a.email, keychain_service: "relay-mail", keychain_account: a.email }, result: "Connected" };
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
    case "integration_thumb":
      return a.url === integ.THUMB_URL ? thumb : Promise.reject("not a picture");
  }
  unmocked.add(cmd);
  console.warn(`[harness] unmocked command ${cmd}`, a);
  return null;
}

// ---------- ready: the first quiet 250 ms after the window's start-up calls (the polls do not count)
const POLLS = new Set(["pending", "subagents", "history_sid", "agents", "app_sids", "app_sessions", "running", "plugin:window|is_focused"]);
let markReady: () => void;
const ready = new Promise<void>(resolve => (markReady = resolve));
let quietTimer = 0;
const settle = () => {
  clearTimeout(quietTimer);
  quietTimer = window.setTimeout(() => markReady(), 250);
};

mockWindows(isSettingsWindow ? "settings" : "main");
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
const nextTask = () => new Promise<void>(resolve => {
  const channel = new MessageChannel();
  channel.port1.onmessage = () => resolve();
  channel.port2.postMessage(0);
});
/** The next frame has been painted: a task right after the next animation frame. */
const nextPaint = () => new Promise<number>(resolve => requestAnimationFrame(() => nextTask().then(() => resolve(performance.now()))));

async function stream({ key, deltas, tokensPerDelta = 3, ratePerSecond = 0, tools = true }: StreamOpts): Promise<StreamStats> {
  const words = conv.replyText(deltas * tokensPerDelta);
  const perDelta: number[] = [];
  const start = performance.now();
  if (tools) {
    emitAgent(key, { type: "tool_call", id: `toolu_stream_${start | 0}`, name: "Read", input: { file_path: `${vault.VAULT}/Calendar/2026-10-01.md` } });
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
  emitAgent(key, { type: "turn_end", ok: true, error: null, usage: { input: 1200, output: deltas * tokensPerDelta, cacheRead: 0, cacheWrite: 0 }, duration_ms: Math.round(performance.now() - start) });
  await nextTask();
  const renderedAt = await nextPaint();
  return { perDelta, total: renderedAt - start, renderedAt };
}

const harness = {
  ready,
  calls,
  unmocked,
  autoReply: true,
  fixture,
  now: NOW,
  keys: { long: conv.LONG_KEY, switchTo: conv.SWITCH_KEY, permission: conv.PERMISSION_KEY, question: conv.QUESTION_KEY, action: conv.ACTION_KEY, terminal: `t:${vault.terminalSessions[0].sessionId}` },
  titles: { long: conv.LONG_TITLE, switchTo: conv.SWITCH_TITLE, permission: conv.PERMISSION_TITLE, question: conv.QUESTION_TITLE, action: conv.ACTION_TITLE },
  markers: { longEnd: conv.LONG_END, switchEnd: conv.endMarker(conv.SWITCH_KEY), card: integ.CARD_TITLE, plainMail: integ.PLAIN_MAIL.subject, htmlMail: integ.HTML_MAIL.subject, studioMail: integ.STUDIO_MAIL.subject },
  emit,
  emitAgent,
  stream,
  nextTask,
  nextPaint,
  /** a relay:// link while the app runs (Raycast, a browser), as the deep-link plugin delivers it */
  deepLink: (url: string) => emit("deep-link://new-url", [url]),
  /** what a fresh session ran on when the model and effort were left to the CLI (read_agent's `resolved`) */
  resolved: (key: string, model = "opus", effort = "high") => emitAgent(key, { type: "resolved", model, effort, default_model: true, default_effort: true }),
  /** the live events after the long conversation opened: running and failed tools, an error, a draft note */
  liveTail: (key = conv.LONG_KEY) => conv.liveTail().forEach(event => emitAgent(key, event)),
};
(window as any).__harness = harness;
export type Harness = typeof harness;
