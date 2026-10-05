import { t } from "../../shared/i18n";
import type { AgentEvent } from "../../domain/agents/types";
import { adoptOwnedTurns, toItems, trackTimes, doneText, push } from "../../domain/conversations/events";
import { UNTITLED } from "../../domain/conversations/rules";
import { lastTurnIs } from "../../domain/orchestrator/rules";
import { isTerminal, termSid } from "../../domain/navigation/keys";
import * as backend from "../../infrastructure/backend";
import { useNavigationStore } from "../navigation/store";
import { request } from "../navigation/requests";
import { useConversationsStore } from "./store";
import { imageUrl } from "./images";
import { saveChats } from "./chats";
import { lastAi } from "./selectors";
import { flush, notify } from "./events";

// The transcripts behind a conversation: its history when it opens, a terminal session followed, and a turn that
// runs in a process this page gets no events from.
const cs = () => useConversationsStore.getState();
const set = useConversationsStore.setState;

/** A terminal conversation: first the whole transcript, then only what was added since the last read. */
export async function tailTerm(key: string): Promise<boolean> {
  const transcript = await backend.historySid(termSid(key), cs().termOffset[key] ?? 0);
  const fresh = cs().termOffset[key] === undefined;
  const added = toItems(transcript.items, imageUrl);
  set(draft => {
    draft.termOffset[key] = transcript.next;
    if (fresh) draft.messages[key] = added;
    else if (added.length) draft.messages[key].push(...added);
  });
  return fresh || added.length > 0;
}
/** The conversation's history from its transcript, once (`fresh` reads it again). */
export async function ensureHistory(key: string, fresh = false) {
  if (isTerminal(key)) {
    if (!cs().messages[key] || fresh) await tailTerm(key);
    return;
  }
  if (cs().messages[key] && !fresh) return;
  const items = toItems(await backend.history(key), imageUrl);
  let retitled = false;
  set(draft => {
    draft.messages[key] = items;
    const firstMessage = items.find(item => item.kind === "me");
    const conversation = draft.chats[key];
    if (conversation && UNTITLED.includes(conversation.title) && firstMessage) {
      conversation.title = (firstMessage.text || t("chat.image")).slice(0, 48);
      retitled = true;
    }
  });
  if (retitled) saveChats();
}

/** Relay wrote a user turn itself (a worker's brief, a report into the coordinator): it shows and counts as a turn, like
 *  one sent from the composer, and the agent's events follow. */
export async function relayWrote(key: string, text: string) {
  // a conversation not read yet gets its transcript first, the events that follow land on top of it
  if (!cs().messages[key]) await ensureHistory(key).catch(() => {});
  flush();
  set(draft => {
    // the transcript just read may hold this turn already
    if (!lastTurnIs(draft.messages[key], text)) push(draft, key, { kind: "me", text });
    draft.status[key] = "busy";
    draft.queued[key] = (draft.queued[key] || 0) + 1;
  });
  if (key === useNavigationStore.getState().selected) request("scroll-bottom");
}

// ---------- a turn this page did not start: after a reload of the page (the app's process still sends its events, only
// the dots are missing) or after an app restart (the process lives on without the app, the transcript is followed).
// Only for a conversation the page knows nothing about yet, so a late "busy" never brings back the dots of a finished turn.
export async function syncBusy() {
  const liveAgents = new Map(cs().agentsList.map(agent => [`${agent.provider}:${agent.sessionId}`, agent]));
  const running = await backend.running().catch(() => ({}) as Record<string, number>);
  // the app's own process table knows the active turns, also of a fresh process that has not named its session yet;
  // the CLIs' session lists only describe what is persisted
  let owned = new Set<string>();
  let adopted: string[] = [];
  set(draft => {
    ({ owned, adopted } = adoptOwnedTurns(draft, running));
  });
  // the events that follow land on top of the transcript
  for (const key of adopted) if (!cs().messages[key]) await ensureHistory(key);
  for (const [key, conversation] of Object.entries(cs().chats)) {
    const session = cs().sidOf[key];
    if (conversation.closed || owned.has(key) || !session) continue;
    const busy = liveAgents.get(`${session.provider}:${session.sid}`)?.status === "busy";
    if (busy && cs().status[key] === undefined) await adoptRunningTurn(key, session.provider, session.sid);
    else if (!busy && key in cs().outside) await finishOutsideTurn(key);
  }
}
async function adoptRunningTurn(key: string, provider: string, sid: string) {
  set(draft => {
    draft.status[key] = "busy";
  });
  const transcript = await backend.historySid(sid, 0, provider);
  set(draft => {
    draft.messages[key] = toItems(transcript.items, imageUrl);
    draft.outside[key] = transcript.next;
    trackTimes(draft, key, transcript.items);
  });
}
async function finishOutsideTurn(key: string) {
  await tailOutside(key);
  set(draft => {
    delete draft.outside[key];
    draft.status[key] = "idle";
    const span = draft.outsideAt[key];
    delete draft.outsideAt[key];
    push(draft, key, {
      kind: "done",
      text: doneText(span && span.to > span.from ? (span.to - span.from) / 1000 : 0, t),
    });
    if (key !== useNavigationStore.getState().selected) draft.unseen.add(key);
  });
  notify(key, lastAi(key));
}
/** What a turn running outside the app added to its transcript since the last read. */
export async function tailOutside(key: string) {
  const { sid, provider } = cs().sidOf[key];
  const transcript = await backend.historySid(sid, cs().outside[key], provider);
  const added = toItems(transcript.items as AgentEvent[], imageUrl);
  set(draft => {
    draft.outside[key] = transcript.next;
    trackTimes(draft, key, transcript.items);
    if (added.length) draft.messages[key].push(...added);
  });
}
