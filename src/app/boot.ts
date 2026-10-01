import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { initI18n } from "../core/i18n";
import { changed, ls } from "../core/store";
import type { AgentEvent } from "../domain/agents";
import { loadAgents } from "../domain/agents";
import type { VaultStatus } from "../domain/vault-setup";
import { ui, BOARD, PRS, MAIL, WAIT, isView, isTerm, boardKey } from "../domain/ui";
import { config, ghOn, mailOn, type Settings } from "../domain/config";
import { loadSnapshot, project, refreshIcons, reloadIcons, checkFavicons } from "../domain/vault";
import { chat, termOf, saveChats, newChat } from "../domain/chats/state";
import { onEvent, ensureHistory, tailTerm, tailOutside } from "../domain/chats/events";
import { pollPending, pollAgents, pollSubs, agentsStale } from "../domain/chats/polls";
import { closeChat } from "../domain/chats/actions";
import { select, newHere } from "../domain/navigation";
import { boards, checkBoards, resetBoard } from "../domain/board";
import { loadPrs, resetPrs } from "../domain/prs";
import { loadMails, resetMail, mailLinkClicked } from "../domain/mail";
import { panel, closePr } from "../domain/panel";
import { startUsage, reloadUsage } from "../domain/usage";
import { onboard } from "../features/onboarding/onboard";

const boardDown = (k: string) => { const p = k.startsWith(`${BOARD}:`) ? k.slice(BOARD.length + 1) : ""; return !!p && !boards.ready.includes(p); };

// the settings window saved: follow it here
async function settingsChanged(next: Settings) {
  const relang = next.language !== config.value.language;
  const intChanged = JSON.stringify(next.integrations) !== JSON.stringify(config.value.integrations);
  const ghChanged = JSON.stringify(next.github) !== JSON.stringify(config.value.github);
  const mailChanged = JSON.stringify(next.mail) !== JSON.stringify(config.value.mail);
  config.value = { ...config.value, ...next };
  // a new language applies without a restart. The board drops its cache: task labels are built in the language
  if (intChanged || relang) resetBoard();
  if (relang) await initI18n();
  if (ghChanged) { resetPrs(); if (!ghOn() && ui.sel === PRS) select(WAIT); loadPrs(); }
  if (mailChanged) { resetMail(); if (panel.open.startsWith("mail:")) closePr(); if (!mailOn() && ui.sel === MAIL) select(WAIT); loadMails(); }
  changed();
  checkBoards().then(() => { if (boardDown(ui.sel)) select(WAIT); loadSnapshot(); });
  loadAgents().then(reloadUsage);
}

// The main window's start: settings, language and vault first, then the conversations from earlier versions, then the polls.
export async function boot() {
  listen<{ project: string; provider: string; event: AgentEvent }>("agent", e => onEvent(e.payload.project, e.payload.event));
  listen<string>("open-chat", e => select(e.payload));
  listen<string>("mail-link", e => mailLinkClicked(e.payload));
  listen<Settings>("settings-changed", e => settingsChanged(e.payload));
  // the Gesprek menu: Cmd-T general, Cmd-N in the current project, Cmd-W closes the open conversation
  listen<string>("menu", e => {
    if (e.payload === "new-general") select(newChat(null));
    else if (e.payload === "new-project") newHere();
    else if (e.payload === "close-chat" && !isView(ui.sel) && !chat.chats[ui.sel]?.draft) closeChat(ui.sel);
  });
  try { config.value = { ...config.value, ...(await invoke<Settings>("get_settings")) }; } catch { /* older backend */ }
  await initI18n();
  // no vault yet, or the configured one is gone: choose one before anything reads it
  const vs = await invoke<VaultStatus>("vault_status");
  if (!vs.ok) { await onboard(vs); config.value = { ...config.value, ...(await invoke<Settings>("get_settings")) }; }
  await loadSnapshot();
  await refreshIcons();
  listen("icons-changed", reloadIcons);
  // conversations from earlier versions: general:<id>, plain project names
  const oldGens = ls.get<Record<string, { title: string; at: number }>>("gens", {});
  for (const k of await invoke<string[]>("chats")) {
    if (chat.chats[k]) continue;
    if (k.startsWith("general:")) chat.chats[k] = { key: k, project: null, title: oldGens[k]?.title || "Algemeen gesprek", at: oldGens[k]?.at || parseInt(k.slice(8), 36) || 0 };
    else if (project(k)) chat.chats[k] = { key: k, project: k, title: "Gesprek", at: 0 };
    else chat.chats[k] = { key: k, project: null, title: "Gesprek", at: parseInt(k.slice(2), 36) || 0 };
  }
  // the agent of each conversation with a session, from sessions.json (entries from before the providers are Claude's)
  for (const [k, p] of Object.entries(await invoke<Record<string, string>>("chat_providers").catch(() => ({} as Record<string, string>)))) if (chat.chats[k]) chat.chats[k].provider = p;
  saveChats();
  loadAgents();
  await Promise.all(Object.values(chat.chats).filter(c => ["Gesprek", "Algemeen gesprek"].includes(c.title)).map(c => ensureHistory(c.key)));
  await pollAgents();
  await checkBoards();
  if (ui.sel === BOARD) ui.sel = boardKey("productive"); // the one board before the providers
  if ((!isView(ui.sel) && !chat.chats[ui.sel] && !termOf(ui.sel)) || boardDown(ui.sel) || (ui.sel === PRS && !ghOn()) || (ui.sel === MAIL && !mailOn())) ui.sel = WAIT;
  await select(ui.sel);
  pollPending();
  setInterval(pollPending, 700);
  setInterval(pollAgents, 10000);
  pollSubs();
  setInterval(pollSubs, 2000);
  // a terminal conversation that is open in the app: new transcript lines and its busy state every 2 s
  setInterval(async () => {
    if (!isTerm(ui.sel)) return;
    await Promise.all([tailTerm(ui.sel), invoke<any[]>("agents").then(a => { chat.agentsList = a; })]);
    changed();
  }, 2000);
  // while one runs outside: its transcript every 2 s, and the providers' sessions every 4 s to see the turn end
  setInterval(async () => {
    const ks = Object.keys(chat.outside); if (!ks.length) return;
    for (const k of ks) await tailOutside(k).catch(() => {});
    if (agentsStale()) pollAgents();
  }, 2000);
  setInterval(loadSnapshot, 30000);
  listen("reminders-changed", loadSnapshot);
  setInterval(checkFavicons, 60 * 60000); // a project new in work-state gets its icon within the hour
  if (ui.sel !== PRS) loadPrs(); // select() already loads it when the view is open
  setInterval(loadPrs, 5 * 60000);
  startUsage(); // plan limits for the sidebar, tokens while the view is open
  if (ui.sel !== MAIL) loadMails();
  setInterval(loadMails, 5 * 60000);
}
