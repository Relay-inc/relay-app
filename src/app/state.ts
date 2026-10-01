import { t } from "../i18n";
import type { Key } from "../locales/en";
import { ls } from "../lib/store";
import { PROVIDERS, provider, type BoardRef } from "../providers";
import type { AgentsStatus, AgentEvent } from "../agents";
import type { PRs } from "../github";
import type { Mail, MailFilter } from "../mail";
import type { ProjectIcon } from "../project-icons";

// Everything the main window knows, in one place. The logic (actions.ts, events.ts) changes it in place and calls
// `changed()`; the components (src/ui/) read it while they render.

// ---------- conversations
// A conversation has its own key and hangs under a project (or under Algemeen when project is null).
// The key never changes, so moving a conversation to a project is only a label: the running
// process and its session are untouched. Metadata is kept locally, the session lives in Claude Code.
/** A tool line keeps the call, so it is drawn (and translated) when shown. */
export type Item = { kind: "me" | "ai" | "tool" | "err" | "note" | "done"; text: string; id?: string; state?: "run" | "ok" | "err"; path?: string; imgs?: string[];
  tool?: { name: string; input: any } };
export type Chat = { key: string; project: string | null; title: string; at: number; draft?: boolean; fork?: string; closed?: number; mail?: string;
  provider?: string; // its agent, set at the first message
  fromMail?: boolean /* about a mail or has read mail */ };
export type Img = { mt: string; data: string; url: string };
/** A subagent a session spawned (Agent tool, background agents). */
export type Sub = { id: string; description: string; agentType?: string; model?: string; running: boolean; started_at: string; last_at: string; tool?: string; input?: any; text?: string };
/** A session open in the terminal (not started by the app), with the project snapshot.py read from its transcript. */
export type Term = { key: string; sid: string; id: string; project: string | null; title: string; kind: string; status: string; state?: string; mtime: number };
export type Settings = { vault: string; projects: Record<string, { icon?: string; img?: string; label?: string }>; overrides: Record<string, string | null>;
  integrations: Record<string, any>; boards: Record<string, BoardRef>; github: { on: boolean; owners: string }; mail: { on: boolean; account: string; accounts: { email: string; keychain_service: string; keychain_account: string }[] }; language?: string;
  favicons?: { on: boolean; last?: string; tried: Record<string, string> } };

export const USAGE = "__usage", WAIT = "__wait", REM = "__rem", BOARD = "__board", PRS = "__prs", MAIL = "__mail", NEW = "Nieuw gesprek";
export const VIEWS = [WAIT, REM, PRS, MAIL, USAGE];

export const S = {
  convo: {} as Record<string, Item[]>,
  status: {} as Record<string, "idle" | "busy">,
  queued: {} as Record<string, number>, // messages sent but not answered yet: one turn end each
  unseen: new Set<string>(),
  dismissed: new Set<string>(), // "is this about project X?" answered no
  chats: ls.get<Record<string, Chat>>("chats", {}),
  // what is typed but not sent, per conversation: survives switching and closing the app
  typed: ls.get<Record<string, string>>("typed", {}),
  attached: [] as Img[], // waiting in the composer until the next send
  pendingList: [] as any[],
  pendingPolled: false, // the cards already waiting at start get no banner
  agentsList: [] as any[],
  hidden: ls.get<string[]>("hiddenAgents", []),
  forked: ls.get<string[]>("forkedTerms", []), // terminal sessions continued in the app, no longer listed
  snap: { projects: [], reminders: [], sessions: { items: [] } } as any,
  snapErr: "",
  appSids: [] as string[],
  sidOf: {} as Record<string, { provider: string; sid: string }>, // app conversation key: its provider and session id
  // app conversations whose turn runs in a process this page gets no events from (it outlived an app restart):
  // the transcript offset read so far. The page follows the transcript until the provider's sessions say the turn ended
  outside: {} as Record<string, number>,
  // when that turn's prompt came in and the last line after it, from the transcript timestamps, for "Klaar · duur"
  outsideAt: {} as Record<string, { from: number; to: number }>,
  termOffset: {} as Record<string, number>,
  subs: {} as Record<string, Sub[]>, // per conversation key, polled every 2 s
  subsOpen: new Set<string>(), // conversations whose finished agents are unfolded
  subLog: {} as Record<string, string[]>, // agent id: its last messages, while unfolded
  routeChoice: null as { key: string; text: string; hits: string[] } | null,
  icons: {} as Record<string, ProjectIcon>, // from the vault's .relay/config.json (src/project-icons.ts)
  settings: { vault: "", projects: {}, overrides: {}, integrations: {}, boards: {}, github: { on: false, owners: "" }, mail: { on: false, account: "", accounts: [] } } as Settings,
  settingsMsg: "",
  boardsReady: [] as string[], // a board row only shows once its integration is switched on and set up
  lastP: null as string | null, // the vault project last shown, so its linked board opens with the board view
  sel: ls.get<string>("sel", "") || WAIT,
  tab: "open",
  noinsp: ls.get<boolean>("noinsp", false), // the right panel folded away
  // pull requests via gh, once GitHub is switched on
  prs: null as PRs | null, prErr: "", prBusy: false,
  // one PR, mail or board card (key "card:<provider>:<id>") open in the right panel, which widens for it
  prOpen: "", prDetailErr: "",
  prDetail: {} as Record<string, any>,
  cardRefs: {} as Record<string, BoardRef>,
  // mail: a link clicked inside a mail waits for the user's go, which open mails show the text instead of the html
  mailLink: "", mailText: new Set<string>(),
  mails: null as Mail[] | null, mailErr: "", mailBusy: false,
  mailGen: 0, // bumped when the mail settings change: an answer from an older generation is dropped
  mailPages: 0, mailEnd: false, mailMore: false, // pages of 50 loaded, whether the last one came back short
  mailFilter: { q: "", state: "all", project: "", ...ls.get("mailFilter", {}) } as MailFilter,
  // the sidebar
  find: "",
  collapsed: ls.get<Record<string, boolean>>("collapsed", {}),
  unfolded: new Set<string>(), // projects whose conversations past the first five are shown
  secOrder: ls.get<string[]>("secOrder", ["Algemeen"]), // order the user dragged: sections,
  projOrder: ls.get<Record<string, string[]>>("projOrder", {}), // projects within a section,
  convOrder: ls.get<Record<string, string[]>>("convOrder", {}), // conversations per project (or "" for Algemeen)
  // agent providers: the composer's agent, model and effort picks follow the open conversation
  agentsSt: { default: "claude", providers: [] } as AgentsStatus, agentsLoaded: false,
  // overlays
  pop: false, // the conversation's project panel under the title
  toast: null as { text: string; undo?: () => void; btn?: string } | null,
  zoom: "", // the image shown large
  qk: false, // Cmd-K
};

// ---------- views and boards
// a provider's board is the view "__board:<provider id>"
export const boardKey = (id: string) => `${BOARD}:${id}`;
export const boardOf = (k: string) => k.startsWith(`${BOARD}:`) ? provider(k.slice(BOARD.length + 1)) : undefined;
export const isView = (k: string) => VIEWS.includes(k) || !!boardOf(k);
export const boardDown = (k: string) => { const p = boardOf(k); return !!p && !S.boardsReady.includes(p.id); };
export const readyBoards = () => PROVIDERS.filter(p => S.boardsReady.includes(p.id));
export const ghOn = () => !!S.settings.github?.on;
export const mailOn = () => !!S.settings.mail?.on;

// ---------- names
// placeholder titles are stored as they always were (Dutch) and shown in the UI language
const PLACEHOLDER: Record<string, Key> = { [NEW]: "nav.newChat", Gesprek: "chat.untitled", "Algemeen gesprek": "chat.general" };
export const shownTitle = (title: string) => PLACEHOLDER[title] ? t(PLACEHOLDER[title]) : title;
export const project = (n: string | null) => n ? S.snap.projects.find((p: any) => p.name === n) : undefined;
// how a project is shown: its own icon and name from the settings, else the note name
export const pLabel = (n: string | null) => { if (!n) return t("general"); const c = S.settings.projects[n] || {}, e = S.icons[n]?.icon; return `${e ? e + " " : ""}${c.label || n}`; };
/** Vault projects by their label, for a picker. */
export const projectsByLabel = (locale: string) => S.snap.projects.map((p: any) => ({ name: p.name as string, label: pLabel(p.name) })).sort((a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label, locale));
export const projOf = (key: string) => S.chats[key]?.project ?? null;
export const label = (key: string) => shownTitle(S.chats[key]?.title || key);
export const chatsOf = (p: string | null) => Object.values(S.chats).filter(c => c.project === p && !c.draft && !c.closed).sort((a, b) => b.at - a.at);
export const saveChats = () => ls.set("chats", Object.fromEntries(Object.entries(S.chats).filter(([k, c]) => !c.draft || S.typed[k])));
export function newChat(p: string | null): string {
  const key = `c:${Date.now().toString(36)}`;
  S.chats[key] = { key, project: p, title: NEW, at: Date.now(), draft: true };
  return key;
}
// contexts come from the vault index, in its order
export const contexts = (): string[] => [...new Set<string>(S.snap.projects.map((p: any) => p.context))];

// ---------- which project a text is about: names plus aliases from the note frontmatter
const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function findProjects(text: string): string[] {
  const hits = new Set<string>();
  for (const p of S.snap.projects) for (const n of [p.name, ...(p.aliases || [])]) {
    if (n.length < 3) continue;
    if (new RegExp(`(^|[^\\p{L}\\p{N}])${reEsc(n)}([^\\p{L}\\p{N}]|$)`, "iu").test(text)) hits.add(p.name);
  }
  return [...hits];
}
export function aboutProject(key: string): string | null {
  const score: Record<string, number> = {};
  for (const it of S.convo[key] || []) {
    if (it.kind === "me") for (const p of findProjects(it.text)) score[p] = (score[p] || 0) + 1;
    if (it.kind === "tool" && it.path) for (const p of S.snap.projects) {
      // a note or folder named after the project, wherever the vault keeps it
      if (it.path.split("/").some(seg => seg.replace(/\.md$/, "") === p.name)) score[p.name] = (score[p.name] || 0) + 2;
    }
  }
  const top = Object.entries(score).sort((a, b) => b[1] - a[1]);
  return top.length && (top.length === 1 || top[0][1] >= 2 * top[1][1]) ? top[0][0] : null;
}

// ---------- terminal sessions (not started by the app)
const GENERIC = /^obsidian-context-management-\w+$/;
export function terms(hiddenOnes = false): Term[] {
  const live = new Map(S.agentsList.map(a => [a.sessionId, a]));
  return (S.snap.sessions?.items || []).filter((x: any) => !S.appSids.includes(x.sessionId) && S.forked.includes(x.sessionId) === hiddenOnes && live.has(x.sessionId))
    .map((x: any) => { const a = live.get(x.sessionId);
      const ov = S.settings.overrides[x.sessionId];
      return { key: `t:${x.sessionId}`, sid: x.sessionId, id: a.id, mtime: x.last_at ? Date.parse(x.last_at) : 0, project: ov !== undefined ? ov : x.project ?? null, kind: a.kind, status: a.status, state: a.state,
        title: a.name && !GENERIC.test(a.name) ? a.name : (x.last_user || t("chat.terminal")).slice(0, 48) }; })
    .filter((tm: Term) => !(tm.kind === "background" && tm.state === "done"));
}
export const termOf = (k: string) => terms().find(tm => tm.key === k);
export const isTerm = (k: string) => k.startsWith("t:");
/** The project of the open conversation, terminal or app. */
export const selProject = () => isTerm(S.sel) ? termOf(S.sel)?.project ?? null : projOf(S.sel);
// background terminal sessions that wait
export const blockedAgents = () => S.agentsList.filter(a => a.kind === "background" && a.state === "blocked" && !S.hidden.includes(a.id));
export const waitCount = () => S.pendingList.length + blockedAgents().length;
export const waits = (k: string) => S.pendingList.some(r => r.project === k);
export const runningSubs = (k: string) => (S.subs[k] || []).filter(a => a.running).length;
// what was closed under a project (or under Algemeen when p is null), newest first
export function closedOf(p: string | null): { key: string; title: string }[] {
  const cs = Object.values(S.chats).filter(c => c.closed && c.project === p).sort((a, b) => b.closed! - a.closed!).map(c => ({ key: c.key, title: shownTitle(c.title) }));
  const ts = terms(true).filter(tm => tm.project === p).map(tm => ({ key: tm.key, title: tm.title }));
  return [...cs, ...ts].slice(0, 8);
}

// ---------- agents
export const onAgents = () => S.agentsSt.providers.filter(p => p.on);
export const agentOf = (id: string) => S.agentsSt.providers.find(p => p.id === id);
export const chatAgent = (k: string) => isTerm(k) ? "claude" : S.chats[k]?.provider || S.agentsSt.default || "claude";
// the last pick per provider; Claude's under the keys from before the providers
export const pickKey = (kind: "model" | "effort", id: string) => id === "claude" ? kind : `${kind}.${id}`;
// before the providers have answered, the composer offers Claude's models as it always did
const FALLBACK: Record<"model" | "effort", { id: string; label: string }[]> = {
  model: [["fable", "Fable"], ["opus", "Opus"], ["sonnet", "Sonnet"], ["haiku", "Haiku"]].map(([id, label]) => ({ id, label })),
  effort: [["low", "Low"], ["medium", "Medium"], ["high", "High"], ["xhigh", "Extra high"], ["max", "Max"]].map(([id, label]) => ({ id, label })),
};
/** The model or effort choices of the open conversation's agent, and the one picked (a stale pick reads as the default). */
export function picks(kind: "model" | "effort") {
  const id = chatAgent(S.sel), st = agentOf(id);
  const list = st ? (kind === "model" ? st.models : st.efforts) : FALLBACK[kind], want = ls.get(pickKey(kind, id), "");
  return { list, value: list.some(c => c.id === want) ? want : "", key: pickKey(kind, id) };
}

// ---------- tool lines and durations
export const base = (p = "") => p.split("/").pop() || p;
export const dur = (sec: number) => { const s = Math.max(0, Math.round(sec)); return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`; };
export const lastAi = (k: string) => [...(S.convo[k] || [])].reverse().find(i => i.kind === "ai")?.text || t("work.done");
export type { AgentEvent };
