import { t } from "../../core/i18n";
import type { Key } from "../../core/locales/en";
import { ls } from "../../core/store";
import { ui, isTerm } from "../ui";
import { vault, findProjects } from "../vault";
import { config } from "../config";
import { termKey, newChatKey } from "../keys";

// The conversations: the app's own (with their messages, state and drafts), the terminal sessions next to them, and
// what waits for the user (permission cards, questions, background sessions that block).

// A conversation has its own key and hangs under a project (or under Algemeen when project is null).
// The key never changes, so moving a conversation to a project is only a label: the running
// process and its session are untouched. Metadata is kept locally, the session lives in Claude Code.
/** What a tool call carries, as far as the app reads it (the tool line, the permission card, the project guess). */
export type ToolInput = {
  file_path?: string;
  content?: string;
  command?: string;
  pattern?: string;
  query?: string;
  url?: string;
  description?: string;
  subagent_type?: string;
  skill?: string;
  questions?: Question[];
  [other: string]: unknown;
};
/** A question an agent asks, with its options (AskUserQuestion). */
export type Question = { question: string; multiSelect?: boolean; options?: { label: string; description?: string }[] };
/** A session as the agent providers report it (`agents`): in the terminal or in the background. */
export type AgentSession = {
  id: string;
  sessionId: string;
  provider: string;
  kind: string; // "interactive" | "background"
  status: string; // "busy" | "idle"
  state?: string; // a background session: "blocked" | "done" | …
  name?: string;
  startedAt?: string;
};
/** A tool line keeps the call, so it is drawn (and translated) when shown. */
export type Item = {
  kind: "me" | "ai" | "tool" | "err" | "note" | "done";
  text: string;
  id?: string;
  state?: "run" | "ok" | "err";
  path?: string;
  imgs?: string[];
  tool?: { name: string; input: ToolInput };
};
export type Chat = {
  key: string;
  project: string | null;
  title: string;
  at: number;
  draft?: boolean;
  fork?: string;
  closed?: number;
  mail?: string;
  provider?: string; // its agent, set at the first message
  fromMail?: boolean; /* about a mail or has read mail */
};
export type Img = { mt: string; data: string; url: string };
/** A subagent a session spawned (Agent tool, background agents). */
export type Sub = {
  id: string;
  description: string;
  agentType?: string;
  model?: string;
  running: boolean;
  started_at: string;
  last_at: string;
  tool?: string;
  input?: ToolInput;
  text?: string;
};
/** A session open in the terminal (not started by the app), with the project snapshot.py read from its transcript. */
export type Term = {
  key: string;
  sid: string;
  id: string;
  project: string | null;
  title: string;
  kind: string;
  status: string;
  state?: string;
  mtime: number;
};
/** A permission request or question waiting in pending/ (packages/agent-core PermissionRequest). */
export type Pending = { id: string; project: string; kind?: string; tool_name: string; input: ToolInput };

export const NEW = "Nieuw gesprek";

export const chat = {
  chats: ls.get<Record<string, Chat>>("chats", {}),
  convo: {} as Record<string, Item[]>,
  status: {} as Record<string, "idle" | "busy">,
  queued: {} as Record<string, number>, // messages sent but not answered yet: one turn end each
  unseen: new Set<string>(),
  dismissed: new Set<string>(), // "is this about project X?" answered no
  // what is typed but not sent, per conversation: survives switching and closing the app
  typed: ls.get<Record<string, string>>("typed", {}),
  attached: [] as Img[], // waiting in the composer until the next send
  routeChoice: null as { key: string; text: string; hits: string[] } | null,
  pendingList: [] as Pending[],
  pendingPolled: false, // the cards already waiting at start get no banner
  agentsList: [] as AgentSession[], // the providers' sessions (`agents`), terminal and background
  hidden: ls.get<string[]>("hiddenAgents", []),
  forked: ls.get<string[]>("forkedTerms", []), // terminal sessions continued in the app, no longer listed
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
};

// ---------- names
// placeholder titles are stored as they always were (Dutch) and shown in the UI language
const PLACEHOLDER: Record<string, Key> = {
  [NEW]: "nav.newChat",
  Gesprek: "chat.untitled",
  "Algemeen gesprek": "chat.general",
};
export const shownTitle = (title: string) => (PLACEHOLDER[title] ? t(PLACEHOLDER[title]) : title);
export const projOf = (key: string) => chat.chats[key]?.project ?? null;
export const label = (key: string) => shownTitle(chat.chats[key]?.title || key);
export const chatsOf = (p: string | null) =>
  Object.values(chat.chats)
    .filter(c => c.project === p && !c.draft && !c.closed)
    .sort((a, b) => b.at - a.at);
export const saveChats = () =>
  ls.set("chats", Object.fromEntries(Object.entries(chat.chats).filter(([k, c]) => !c.draft || chat.typed[k])));
export function newChat(p: string | null): string {
  const key = newChatKey();
  chat.chats[key] = { key, project: p, title: NEW, at: Date.now(), draft: true };
  return key;
}
export function aboutProject(key: string): string | null {
  const score: Record<string, number> = {};
  for (const it of chat.convo[key] || []) {
    if (it.kind === "me") for (const p of findProjects(it.text)) score[p] = (score[p] || 0) + 1;
    if (it.kind === "tool" && it.path)
      for (const p of vault.snap.projects) {
        // a note or folder named after the project, wherever the vault keeps it
        if (it.path.split("/").some(seg => seg.replace(/\.md$/, "") === p.name))
          score[p.name] = (score[p.name] || 0) + 2;
      }
  }
  const top = Object.entries(score).sort((a, b) => b[1] - a[1]);
  return top.length && (top.length === 1 || top[0][1] >= 2 * top[1][1]) ? top[0][0] : null;
}

// ---------- terminal sessions (not started by the app)
const GENERIC = /^obsidian-context-management-\w+$/;
export function terms(hiddenOnes = false): Term[] {
  const live = new Map(chat.agentsList.map(a => [a.sessionId, a]));
  return vault.snap.sessions.items.flatMap(session => {
    const sid = session.sessionId,
      agent = live.get(sid);
    // only sessions the providers still run, that the app did not start, listed or hidden as asked
    if (!agent || chat.appSids.includes(sid) || chat.forked.includes(sid) !== hiddenOnes) return [];
    if (agent.kind === "background" && agent.state === "done") return [];
    const override = config.value.overrides[sid];
    const named = agent.name && !GENERIC.test(agent.name);
    return [
      {
        key: termKey(sid),
        sid,
        id: agent.id,
        mtime: session.last_at ? Date.parse(session.last_at) : 0,
        project: override !== undefined ? override : session.project,
        kind: agent.kind,
        status: agent.status,
        state: agent.state,
        title: named ? agent.name! : (session.last_user || t("chat.terminal")).slice(0, 48),
      },
    ];
  });
}
export const termOf = (k: string) => terms().find(tm => tm.key === k);
/** The project of the open conversation, terminal or app. */
export const selProject = () => (isTerm(ui.sel) ? (termOf(ui.sel)?.project ?? null) : projOf(ui.sel));
// background terminal sessions that wait
export const blockedAgents = () =>
  chat.agentsList.filter(a => a.kind === "background" && a.state === "blocked" && !chat.hidden.includes(a.id));
export const waitCount = () => chat.pendingList.length + blockedAgents().length;
export const waits = (k: string) => chat.pendingList.some(r => r.project === k);
export const runningSubs = (k: string) => (chat.subs[k] || []).filter(a => a.running).length;
// what was closed under a project (or under Algemeen when p is null), newest first
export function closedOf(p: string | null): { key: string; title: string }[] {
  const cs = Object.values(chat.chats)
    .filter(c => c.closed && c.project === p)
    .sort((a, b) => b.closed! - a.closed!)
    .map(c => ({ key: c.key, title: shownTitle(c.title) }));
  const ts = terms(true)
    .filter(tm => tm.project === p)
    .map(tm => ({ key: tm.key, title: tm.title }));
  return [...cs, ...ts].slice(0, 8);
}
/** A question with options (kind "question"; files from before the providers only have Claude's tool name). */
export const isQuestion = (r: Pending) => r.kind === "question" || r.tool_name === "AskUserQuestion";

export const dur = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
};
export const base = (p = "") => p.split("/").pop() || p;
export const lastAi = (k: string) =>
  [...(chat.convo[k] || [])].reverse().find(i => i.kind === "ai")?.text || t("work.done");
