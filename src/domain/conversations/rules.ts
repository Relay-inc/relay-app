import type { Key } from "../../shared/i18n";
import type { Caps, Decision } from "../agents/types";
import type { Settings } from "../settings/types";
import type { Project, SessionItem } from "../workspace/types";
import { findProjects } from "../workspace/rules.ts";
import { termKey } from "../navigation/keys.ts";
import { ORCH } from "../orchestrator/rules.ts";
import type { ConversationsState, DraftsState, Translate } from "./state";
import type { CardChoice, Chat, Item, Pending, TerminalSession } from "./types";

type S = Pick<ConversationsState, "chats" | "messages">;

export const NEW = "Nieuw gesprek";
// placeholder titles are stored as they always were (Dutch) and shown in the UI language
const PLACEHOLDER: Record<string, Key> = {
  [NEW]: "nav.newChat",
  Gesprek: "chat.untitled",
  "Algemeen gesprek": "chat.general",
};
/** The titles of conversations that never got one: the first message names them once it is read. */
export const UNTITLED = [NEW, "Gesprek", "Algemeen gesprek"];
export const displayTitle = (title: string, t: Translate) => (PLACEHOLDER[title] ? t(PLACEHOLDER[title]) : title);
export const projectOf = (s: Pick<S, "chats">, key: string) => s.chats[key]?.project ?? null;
export const label = (s: Pick<S, "chats">, key: string, t: Translate) => displayTitle(s.chats[key]?.title || key, t);
/** A project's open conversations (null: the general ones), newest first. The orchestrator's coordinator is never one
 *  of them: it has its own row on top of the sidebar. */
export const chatsOf = (s: Pick<S, "chats">, project: string | null) =>
  Object.values(s.chats)
    .filter(
      conversation =>
        conversation.project === project && !conversation.draft && !conversation.closed && conversation.key !== ORCH,
    )
    .sort((newer, older) => older.at - newer.at);
/** What is stored under `chats`: a draft only once something is typed in it. */
export const chatsToStore = (s: Pick<ConversationsState, "chats"> & Pick<DraftsState, "typed">) =>
  Object.fromEntries(Object.entries(s.chats).filter(([key, conversation]) => !conversation.draft || s.typed[key]));
export const newChatEntry = (key: string, project: string | null, now: number): Chat => ({
  key,
  project,
  title: NEW,
  at: now,
  draft: true,
});
/** The project a conversation without one seems to be about, from what was asked and the notes it touched. */
export function aboutProject(s: Pick<S, "messages">, key: string, projects: Project[]): string | null {
  const score: Record<string, number> = {};
  for (const item of s.messages[key] || []) {
    if (item.kind === "me") {
      for (const name of findProjects(projects, item.text)) score[name] = (score[name] || 0) + 1;
    }
    if (item.kind === "tool" && item.path) {
      const segments = item.path.split("/").map(segment => segment.replace(/\.md$/, ""));
      for (const project of projects) {
        // a note or folder named after the project, wherever the vault keeps it
        if (segments.includes(project.name)) score[project.name] = (score[project.name] || 0) + 2;
      }
    }
  }
  const ranked = Object.entries(score).sort((first, second) => second[1] - first[1]);
  const [best, runnerUp] = ranked;
  return best && (!runnerUp || best[1] >= 2 * runnerUp[1]) ? best[0] : null;
}

// ---------- terminal sessions (not started by the app)
const GENERIC = /^obsidian-context-management-\w+$/;
export function terminalSessions(
  s: Pick<ConversationsState, "agentsList" | "appSids" | "forked">,
  sessions: SessionItem[],
  overrides: Settings["overrides"],
  t: Translate,
  hiddenOnes = false,
): TerminalSession[] {
  const liveBySid = new Map(s.agentsList.map(agent => [agent.sessionId, agent]));
  return sessions.flatMap(session => {
    const sid = session.sessionId;
    const agent = liveBySid.get(sid);
    // only sessions the providers still run, that the app did not start (`app`: its process, before its id is known),
    // listed or hidden as asked
    if (!agent || agent.app || s.appSids.includes(sid) || s.forked.includes(sid) !== hiddenOnes) return [];
    if (agent.kind === "background" && agent.state === "done") return [];
    const override = overrides[sid];
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
// background terminal sessions that wait
export const blockedAgents = (s: Pick<ConversationsState, "agentsList" | "hidden">) =>
  s.agentsList.filter(
    agent => agent.kind === "background" && agent.state === "blocked" && !s.hidden.includes(agent.id),
  );
export const waitCount = (s: Pick<ConversationsState, "agentsList" | "hidden" | "pendingList">) =>
  s.pendingList.length + blockedAgents(s).length;
export const isWaiting = (s: Pick<ConversationsState, "pendingList">, key: string) =>
  s.pendingList.some(request => request.project === key);
export const runningSubs = (s: Pick<ConversationsState, "subs">, key: string) =>
  (s.subs[key] || []).filter(sub => sub.running).length;
/** What was closed under a project (or under Algemeen when project is null), newest first. */
export function closedOf(
  s: Pick<ConversationsState, "chats">,
  hiddenTerminals: TerminalSession[],
  project: string | null,
  t: Translate,
): { key: string; title: string }[] {
  const closedChats = Object.values(s.chats)
    .filter(conversation => conversation.closed && conversation.project === project)
    .sort((newer, older) => older.closed! - newer.closed!)
    .map(conversation => ({ key: conversation.key, title: displayTitle(conversation.title, t) }));
  const closedTerminals = hiddenTerminals
    .filter(session => session.project === project)
    .map(session => ({ key: session.key, title: session.title }));
  return [...closedChats, ...closedTerminals].slice(0, 8);
}
/** A question with options (kind "question"; files from before the providers only have Claude's tool name). */
export const isQuestion = (request: Pending) => request.kind === "question" || request.tool_name === "AskUserQuestion";

export const formatDuration = (seconds: number) => {
  const total = Math.max(0, Math.round(seconds));
  return total < 60 ? `${total} s` : `${Math.floor(total / 60)} min ${total % 60} s`;
};
/** The last answer of a conversation, for a banner. */
export const lastAi = (items: Item[] | undefined, t: Translate) =>
  [...(items || [])].reverse().find(item => item.kind === "ai")?.text || t("work.done");

// ---------- permission and question cards
const SKIPPED_QUESTION = "Laurent sloeg de vraag over en antwoordt zelf in het gesprek. Wacht op zijn bericht.";
// a question skipped is answered in the conversation itself
const denial = (request: Pending): Decision => ({
  behavior: "deny",
  message: isQuestion(request) ? SKIPPED_QUESTION : "Geweigerd in de app.",
});
// the picked labels and the typed "other" per question; null when nothing is answered
function questionAnswers(request: Pending, choice: { picked: string[][]; other: string[] }): Decision | null {
  const answers: Record<string, string> = {};
  (request.input.questions || []).forEach((question, i) => {
    const labels = [...(choice.picked[i] || [])];
    const other = (choice.other[i] || "").trim();
    if (other) labels.push(other);
    if (labels.length) answers[question.question] = labels.join(", ");
  });
  if (!Object.keys(answers).length) return null;
  return { behavior: "allow", updatedInput: { ...request.input, answers } };
}
/** What a card's answer tells the agent; null for a question with nothing answered. */
export function decisionOf(request: Pending, choice: CardChoice): Decision | null {
  if (choice === "allow") return { behavior: "allow", updatedInput: request.input };
  if (choice === "always")
    return { behavior: "allow", updatedInput: request.input, updatedPermissions: request.suggestions };
  if (choice === "deny") return denial(request);
  return questionAnswers(request, choice);
}

/** Whether a message sent during a turn waits below the conversation: only when the agent says it took the message up
 *  (`picked`), else it goes into the conversation at once. */
export const waitsForPickup = (caps: Pick<Caps, "picked"> | undefined) => !!caps?.picked;
/** Why a conversation cannot run on a work machine: its agent cannot, or it started with a mail. */
export const machineBlock = (caps: Pick<Caps, "remote"> | undefined, fromMail: boolean): Key | null =>
  !caps?.remote ? "composer.machineOnlyClaude" : fromMail ? "composer.machineNoMail" : null;
