import { t } from "../../shared/i18n";
import { WAIT } from "../../domain/navigation/views";
import { decisionOf } from "../../domain/conversations/rules";
import { attachedIn, readsAttached } from "../../domain/conversations/files";
import { push } from "../../domain/conversations/events";
import type { Pending } from "../../domain/conversations/types";
import * as backend from "../../infrastructure/backend";
import { useConversationsStore, type ConversationsState } from "./store";
import { terminalSessions } from "./selectors";
import { flush, notify } from "./events";
import { syncBusy } from "./history";

// Polling, started once at boot: pending questions often, sessions and the vault now and then.
const cs = () => useConversationsStore.getState();
const set = useConversationsStore.setState;

// cards answered by the app itself, so a poll before their files are gone does not answer them twice
const autoAnswered = new Set<string>();
// reading what the user attached in that conversation needs no card: the drop was the ask. It shows as allowed.
function allowAttachedReads(pending: Pending[]) {
  return pending.filter(request => {
    if (autoAnswered.has(request.id)) return false;
    if (!readsAttached(request, attachedIn(cs().messages[request.project]))) return true;
    autoAnswered.add(request.id);
    backend.answer(request.id, decisionOf(request, "allow")!).catch(() => autoAnswered.delete(request.id));
    flush();
    set(draft => {
      push(draft, request.project, { kind: "allowed", text: String(request.input.file_path ?? request.input.path) });
    });
    return false;
  });
}
/** Permission cards and questions waiting; a new one gives a banner (not the ones already waiting at start). */
export async function pollPending() {
  const next = allowAttachedReads(await backend.pending());
  if (JSON.stringify(next.map(x => x.id)) === JSON.stringify(cs().pendingList.map(x => x.id))) return;
  const known = new Set(cs().pendingList.map(x => x.id));
  if (cs().pendingPolled) {
    for (const request of next.filter(x => !known.has(x.id))) {
      notify(
        cs().chats[request.project] ? request.project : WAIT,
        request.input?.questions?.[0]?.question || t("notify.isWaiting", { tool: request.tool_name }),
      );
    }
  }
  set(draft => {
    draft.pendingList = next;
    draft.pendingPolled = true;
  });
}
/** The subagents of every open conversation and terminal session. */
export async function pollSubs() {
  const keys = [
    ...Object.values(cs().chats)
      .filter(conversation => !conversation.draft && !conversation.closed)
      .map(conversation => conversation.key),
    ...terminalSessions().map(session => session.key),
  ];
  const next = await backend.subagents(keys).catch(() => cs().subs);
  if (JSON.stringify(next) === JSON.stringify(cs().subs)) return;
  set(draft => {
    draft.subs = next;
  });
}
const unchanged = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** The providers' sessions as polled: only what changed is written, so the 2 and 10 s polls redraw nothing when idle. */
export function setSessions(next: Partial<Pick<ConversationsState, "agentsList" | "appSids" | "sidOf">>) {
  const now = cs();
  const changed = (Object.keys(next) as (keyof typeof next)[]).filter(field => !unchanged(next[field], now[field]));
  if (!changed.length) return;
  set(draft => {
    for (const field of changed) Object.assign(draft, { [field]: next[field] });
  });
}
let agentsAt = 0;
/** The providers' sessions, which of them the app started, and each app conversation's session. */
export async function pollAgents() {
  agentsAt = Date.now();
  const [agentsList, appSids, sidOf] = await Promise.all([
    backend.agents(),
    backend.appSids(),
    backend.appSessions().catch(() => cs().sidOf),
  ]);
  setSessions({ agentsList, appSids, sidOf });
  await syncBusy();
}
export const agentsStale = () => Date.now() - agentsAt > 4000;
