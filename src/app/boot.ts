import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { initI18n } from "../core/i18n";
import { changed, ls } from "../core/store";
import type { AgentEvent } from "../domain/agents";
import { loadAgents, loadCommands, sawDefaults } from "../domain/agents";
import type { VaultStatus } from "../domain/vault-setup";
import { ui, PRS, MAIL, WAIT, isView, isTerminal, boardKey } from "../domain/ui";
import { opened, chatTime, isLegacyGeneral, isMailKey, LEGACY_BOARD } from "../domain/keys";
import { config, ghOn, mailOn, type Settings } from "../domain/config";
import { loadSnapshot, project, refreshIcons, reloadIcons, checkFavicons } from "../domain/vault";
import { chat, terminalOf, saveChats, newChat } from "../domain/chats/state";
import { onEvent, ensureHistory, tailTerm, tailOutside } from "../domain/chats/events";
import { pollPending, pollAgents, pollSubs, agentsStale } from "../domain/chats/polls";
import { closeChat } from "../domain/chats/actions";
import { select, newHere } from "../domain/navigation";
import { boards, checkBoards, resetBoard } from "../domain/board";
import { loadPrs, resetPrs } from "../domain/prs";
import { loadMails, resetMail, mailLinkClicked } from "../domain/mail";
import { panel, closeDetail } from "../domain/panel";
import { startUsage, reloadUsage } from "../domain/usage";
import { onboard } from "../features/onboarding/onboard";
import { applyTheme } from "../core/theme";
import type { AgentSession } from "../domain/chats/state";

// a board the sidebar no longer shows: its integration was switched off or lost its token
const boardDown = (key: string) => {
  const view = opened(key);
  return view.kind === "board" && !boards.ready.includes(view.provider);
};

const sameJson = (first: unknown, second: unknown) => JSON.stringify(first) === JSON.stringify(second);

// the settings window saved: follow it here
async function settingsChanged(next: Settings) {
  const languageChanged = next.language !== config.value.language;
  const integrationsChanged = !sameJson(next.integrations, config.value.integrations);
  const githubChanged = !sameJson(next.github, config.value.github);
  const mailChanged = !sameJson(next.mail, config.value.mail);
  // another vault has other commands and skills
  const vaultChanged = next.vault !== config.value.vault;
  config.value = { ...config.value, ...next };
  applyTheme(next.theme, next.accent);
  // a new language applies without a restart. The board drops its cache: task labels are built in the language
  if (integrationsChanged || languageChanged) resetBoard();
  if (languageChanged) await initI18n();
  if (githubChanged) {
    resetPrs();
    if (!ghOn() && ui.selected === PRS) select(WAIT);
    loadPrs();
  }
  if (mailChanged) {
    resetMail();
    if (isMailKey(panel.open)) closeDetail();
    if (!mailOn() && ui.selected === MAIL) select(WAIT);
    loadMails();
  }
  changed();
  checkBoards().then(() => {
    if (boardDown(ui.selected)) select(WAIT);
    loadSnapshot();
  });
  loadAgents().then(reloadUsage);
  if (vaultChanged) loadCommands();
}

// The main window's start: listeners first, then settings, language and vault, then the conversations from earlier
// versions, then the polls.
export async function boot() {
  listenToBackend();
  await loadSettingsAndVault();
  await adoptEarlierConversations();
  await pickStartView();
  startPolls();
}

function listenToBackend() {
  listen<{ project: string; provider: string; event: AgentEvent }>("agent", e =>
    e.payload.event.type === "resolved"
      ? sawDefaults(e.payload.provider, e.payload.event)
      : onEvent(e.payload.project, e.payload.event),
  );
  listen<string>("open-chat", e => select(e.payload));
  listen<string>("mail-link", e => mailLinkClicked(e.payload));
  listen<Settings>("settings-changed", e => settingsChanged(e.payload));
  listen<string>("menu", e => onMenu(e.payload));
}

// the Gesprek menu: Cmd-T general, Cmd-N in the current project, Cmd-W closes the open conversation
function onMenu(item: string) {
  if (item === "new-general") select(newChat(null));
  else if (item === "new-project") newHere();
  else if (item === "close-chat" && !isView(ui.selected) && !chat.chats[ui.selected]?.draft) closeChat(ui.selected);
}

async function loadSettingsAndVault() {
  try {
    config.value = { ...config.value, ...(await invoke<Settings>("get_settings")) };
  } catch {
    /* older backend */
  }
  await initI18n();
  applyTheme(config.value.theme, config.value.accent);
  // no vault yet, or the configured one is gone: choose one before anything reads it
  const vaultStatus = await invoke<VaultStatus>("vault_status");
  if (!vaultStatus.ok) {
    await onboard(vaultStatus);
    config.value = { ...config.value, ...(await invoke<Settings>("get_settings")) };
  }
  await loadSnapshot();
  await refreshIcons();
  listen("icons-changed", reloadIcons);
}

// conversations from earlier versions: general:<id>, plain project names
async function adoptLegacyKeys() {
  const oldGenerals = ls.get<Record<string, { title: string; at: number }>>("gens", {});
  for (const key of await invoke<string[]>("chats")) {
    if (chat.chats[key]) continue;
    if (isLegacyGeneral(key)) {
      chat.chats[key] = {
        key,
        project: null,
        title: oldGenerals[key]?.title || "Algemeen gesprek",
        at: oldGenerals[key]?.at || chatTime(key),
      };
    } else if (project(key)) chat.chats[key] = { key, project: key, title: "Gesprek", at: 0 };
    else chat.chats[key] = { key, project: null, title: "Gesprek", at: chatTime(key) };
  }
}

// the agent of each conversation with a session, from sessions.json (entries from before the providers are Claude's)
async function adoptProviders() {
  const providers = await invoke<Record<string, string>>("chat_providers").catch(() => ({}) as Record<string, string>);
  for (const [key, provider] of Object.entries(providers)) {
    if (chat.chats[key]) chat.chats[key].provider = provider;
  }
}

async function adoptEarlierConversations() {
  await adoptLegacyKeys();
  await adoptProviders();
  saveChats();
  loadAgents();
  loadCommands();
  const untitled = Object.values(chat.chats).filter(conversation =>
    ["Gesprek", "Algemeen gesprek"].includes(conversation.title),
  );
  await Promise.all(untitled.map(conversation => ensureHistory(conversation.key)));
  await pollAgents();
  await checkBoards();
}

// the open view is gone (conversation removed, board or integration switched off): start on the waiting view
const selectedIsGone = () =>
  (!isView(ui.selected) && !chat.chats[ui.selected] && !terminalOf(ui.selected)) ||
  boardDown(ui.selected) ||
  (ui.selected === PRS && !ghOn()) ||
  (ui.selected === MAIL && !mailOn());

async function pickStartView() {
  if (ui.selected === LEGACY_BOARD) ui.selected = boardKey("productive"); // the one board before the providers
  if (selectedIsGone()) ui.selected = WAIT;
  await select(ui.selected);
}

// a terminal conversation that is open in the app: new transcript lines and its busy state every 2 s
async function followOpenTerminal() {
  if (!isTerminal(ui.selected)) return;
  await Promise.all([
    tailTerm(ui.selected),
    invoke<AgentSession[]>("agents").then(agents => {
      chat.agentsList = agents;
    }),
  ]);
  changed();
}

// while one runs outside: its transcript every 2 s, and the providers' sessions every 4 s to see the turn end
async function followOutsideTurns() {
  const keys = Object.keys(chat.outside);
  if (!keys.length) return;
  for (const key of keys) await tailOutside(key).catch(() => {});
  if (agentsStale()) pollAgents();
}

function startPolls() {
  pollPending();
  setInterval(pollPending, 700);
  setInterval(pollAgents, 10000);
  pollSubs();
  setInterval(pollSubs, 2000);
  setInterval(followOpenTerminal, 2000);
  setInterval(followOutsideTurns, 2000);
  setInterval(loadSnapshot, 30000);
  listen("reminders-changed", loadSnapshot);
  setInterval(checkFavicons, 60 * 60000); // a project new in work-state gets its icon within the hour
  if (ui.selected !== PRS) loadPrs(); // select() already loads it when the view is open
  setInterval(loadPrs, 5 * 60000);
  startUsage(); // plan limits for the sidebar, tokens while the view is open
  if (ui.selected !== MAIL) loadMails();
  setInterval(loadMails, 5 * 60000);
}
