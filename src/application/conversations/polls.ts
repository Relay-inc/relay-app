import { t } from "../../shared/i18n";
import { WAIT } from "../../domain/navigation/views";
import * as backend from "../../infrastructure/backend";
import { useConversationsStore, type ConversationsState } from "./store";
import { terminalSessions } from "./selectors";
import { notify } from "./events";
import { syncBusy } from "./history";

// Polling, started once at boot: pending questions often, sessions and the vault now and then.
const cs = () => useConversationsStore.getState();
const set = useConversationsStore.setState;

/** Permission cards and questions waiting; a new one gives a banner (not the ones already waiting at start). */
export async function pollPending() {
  const next = await backend.pending();
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
export function setSessions(next: Partial<Pick<ConversationsState, "agentsList" | "appSids" | "sidOf" | "machines">>) {
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
  const [agentsList, appSids, sidOf, machines] = await Promise.all([
    backend.agents(),
    backend.appSids(),
    backend.appSessions().catch(() => cs().sidOf),
    backend.chatMachines().catch(() => cs().machines), // older backends have no machines
  ]);
  setSessions({ agentsList, appSids, sidOf, machines });
  await syncBusy();
}
export const agentsStale = () => Date.now() - agentsAt > 4000;
/** The machines for the composer's pick in a conversation of `project`, while a new one's composer shows: the backend
 *  answers from what its poller heard, so this is cheap to call every few seconds. */
export async function pollMachines(project: string | null) {
  const list = await backend.machinesList(project).catch(() => null); // older backends have no machines_list
  if (!list || unchanged(list, cs().machineLists[project ?? ""])) return;
  set(draft => {
    draft.machineLists[project ?? ""] = list;
  });
}
