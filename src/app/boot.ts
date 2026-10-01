import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { initI18n } from "../i18n";
import { changed, ls } from "../lib/store";
import { startUsage } from "../usage";
import type { AgentEvent } from "../agents";
import type { VaultStatus } from "../vault-setup";
import { onboard } from "../ui/onboard";
import { S, USAGE, BOARD, PRS, MAIL, WAIT, isView, isTerm, termOf, project, boardKey, boardDown, ghOn, mailOn, saveChats, newChat, type Settings } from "./state";
import { onEvent, ensureHistory, tailTerm, tailOutside } from "./events";
import { loadSnapshot, loadPrs, loadMails, loadAgents, reloadAgentsUsage, pollPending, pollAgents, pollSubs, agentsStale, checkBoards, checkFavicons, refreshIcons, reloadIcons } from "./data";
import { select, settingsChanged, newHere, closeChat, mailLinkClicked } from "./actions";

// The main window's start: settings, language and vault first, then the conversations from earlier versions, then the polls.
export async function boot() {
  listen<{ project: string; provider: string; event: AgentEvent }>("agent", e => onEvent(e.payload.project, e.payload.event));
  listen<string>("open-chat", e => select(e.payload));
  listen<string>("mail-link", e => mailLinkClicked(e.payload));
  listen<Settings>("settings-changed", e => { settingsChanged(e.payload); reloadAgentsUsage(); });
  // the Gesprek menu: Cmd-T general, Cmd-N in the current project, Cmd-W closes the open conversation
  listen<string>("menu", e => {
    if (e.payload === "new-general") select(newChat(null));
    else if (e.payload === "new-project") newHere();
    else if (e.payload === "close-chat" && !isView(S.sel) && !S.chats[S.sel]?.draft) closeChat(S.sel);
  });
  try { S.settings = { ...S.settings, ...(await invoke<Settings>("get_settings")) }; } catch { /* older backend */ }
  await initI18n();
  // no vault yet, or the configured one is gone: choose one before anything reads it
  const vs = await invoke<VaultStatus>("vault_status");
  if (!vs.ok) { await onboard(vs); S.settings = { ...S.settings, ...(await invoke<Settings>("get_settings")) }; }
  await loadSnapshot();
  await refreshIcons();
  listen("icons-changed", reloadIcons);
  // conversations from earlier versions: general:<id>, plain project names
  const oldGens = ls.get<Record<string, { title: string; at: number }>>("gens", {});
  for (const k of await invoke<string[]>("chats")) {
    if (S.chats[k]) continue;
    if (k.startsWith("general:")) S.chats[k] = { key: k, project: null, title: oldGens[k]?.title || "Algemeen gesprek", at: oldGens[k]?.at || parseInt(k.slice(8), 36) || 0 };
    else if (project(k)) S.chats[k] = { key: k, project: k, title: "Gesprek", at: 0 };
    else S.chats[k] = { key: k, project: null, title: "Gesprek", at: parseInt(k.slice(2), 36) || 0 };
  }
  // the agent of each conversation with a session, from sessions.json (entries from before the providers are Claude's)
  for (const [k, p] of Object.entries(await invoke<Record<string, string>>("chat_providers").catch(() => ({} as Record<string, string>)))) if (S.chats[k]) S.chats[k].provider = p;
  saveChats();
  loadAgents();
  await Promise.all(Object.values(S.chats).filter(c => ["Gesprek", "Algemeen gesprek"].includes(c.title)).map(c => ensureHistory(c.key)));
  await pollAgents();
  await checkBoards();
  if (S.sel === BOARD) S.sel = boardKey("productive"); // the one board before the providers
  if ((!isView(S.sel) && !S.chats[S.sel] && !termOf(S.sel)) || boardDown(S.sel) || (S.sel === PRS && !ghOn()) || (S.sel === MAIL && !mailOn())) S.sel = WAIT;
  await select(S.sel);
  pollPending();
  setInterval(pollPending, 700);
  setInterval(pollAgents, 10000);
  pollSubs();
  setInterval(pollSubs, 2000);
  // a terminal conversation that is open in the app: new transcript lines and its busy state every 2 s
  setInterval(async () => {
    if (!isTerm(S.sel)) return;
    await Promise.all([tailTerm(S.sel), invoke<any[]>("agents").then(a => { S.agentsList = a; })]);
    changed();
  }, 2000);
  // while one runs outside: its transcript every 2 s, and the providers' sessions every 4 s to see the turn end
  setInterval(async () => {
    const ks = Object.keys(S.outside); if (!ks.length) return;
    for (const k of ks) await tailOutside(k).catch(() => {});
    if (agentsStale()) pollAgents();
  }, 2000);
  setInterval(loadSnapshot, 30000);
  listen("reminders-changed", loadSnapshot);
  setInterval(checkFavicons, 60 * 60000); // a project new in work-state gets its icon within the hour
  if (S.sel !== PRS) loadPrs(); // select() already loads it when the view is open
  setInterval(loadPrs, 5 * 60000);
  // usage: plan limits for the sidebar, tokens while the view is open
  startUsage(() => S.sel === USAGE, changed);
  if (S.sel !== MAIL) loadMails();
  setInterval(loadMails, 5 * 60000);
}
