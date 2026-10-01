import { invoke } from "@tauri-apps/api/core";
import { t } from "../../core/i18n";
import { changed } from "../../core/store";
import { WAIT } from "../ui";
import { chat, terminalSessions, type Sub, type Pending, type AgentSession } from "./state";
import { notify, syncBusy } from "./events";

// ---------- polling: pending questions often, sessions and the vault now and then
export async function pollPending() {
  const next = await invoke<Pending[]>("pending");
  if (JSON.stringify(next.map(x => x.id)) === JSON.stringify(chat.pendingList.map(x => x.id))) return;
  const known = new Set(chat.pendingList.map(x => x.id));
  if (chat.pendingPolled) {
    for (const request of next.filter(x => !known.has(x.id))) {
      notify(
        chat.chats[request.project] ? request.project : WAIT,
        request.input?.questions?.[0]?.question || t("notify.isWaiting", { tool: request.tool_name }),
      );
    }
  }
  chat.pendingList = next;
  chat.pendingPolled = true;
  changed();
}
export async function pollSubs() {
  const keys = [
    ...Object.values(chat.chats)
      .filter(conversation => !conversation.draft && !conversation.closed)
      .map(conversation => conversation.key),
    ...terminalSessions().map(session => session.key),
  ];
  const next = await invoke<Record<string, Sub[]>>("subagents", { keys }).catch(() => chat.subs);
  if (JSON.stringify(next) === JSON.stringify(chat.subs)) return;
  chat.subs = next;
  changed();
}
let agentsAt = 0;
export async function pollAgents() {
  agentsAt = Date.now();
  [chat.agentsList, chat.appSids, chat.sidOf, chat.machines] = await Promise.all([
    invoke<AgentSession[]>("agents"),
    invoke<string[]>("app_sids"),
    invoke<typeof chat.sidOf>("app_sessions").catch(() => chat.sidOf),
    invoke<typeof chat.machines>("chat_machines").catch(() => chat.machines), // older backends have no machines
  ]);
  await syncBusy();
  changed();
}
export const agentsStale = () => Date.now() - agentsAt > 4000;
