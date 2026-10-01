import { invoke } from "@tauri-apps/api/core";
import { t } from "../../core/i18n";
import { changed } from "../../core/store";
import { WAIT } from "../ui";
import { chat, terms, type Sub } from "./state";
import { notify, syncBusy } from "./events";

// ---------- polling: pending questions often, sessions and the vault now and then
export async function pollPending() {
  const next: any[] = await invoke("pending");
  if (JSON.stringify(next.map(x => x.id)) === JSON.stringify(chat.pendingList.map(x => x.id))) return;
  const known = new Set(chat.pendingList.map(x => x.id));
  if (chat.pendingPolled)
    for (const r of next)
      if (!known.has(r.id))
        notify(
          chat.chats[r.project] ? r.project : WAIT,
          r.input?.questions?.[0]?.question || t("notify.waits", { tool: r.tool_name }),
        );
  chat.pendingList = next;
  chat.pendingPolled = true;
  changed();
}
export async function pollSubs() {
  const keys = [
    ...Object.values(chat.chats)
      .filter(c => !c.draft && !c.closed)
      .map(c => c.key),
    ...terms().map(tm => tm.key),
  ];
  const next = await invoke<Record<string, Sub[]>>("subagents", { keys }).catch(() => chat.subs);
  if (JSON.stringify(next) === JSON.stringify(chat.subs)) return;
  chat.subs = next;
  changed();
}
let agentsAt = 0;
export async function pollAgents() {
  agentsAt = Date.now();
  [chat.agentsList, chat.appSids, chat.sidOf] = await Promise.all([
    invoke<any[]>("agents"),
    invoke<string[]>("app_sids"),
    invoke<typeof chat.sidOf>("app_sessions").catch(() => chat.sidOf),
  ]);
  await syncBusy();
  changed();
}
export const agentsStale = () => Date.now() - agentsAt > 4000;
