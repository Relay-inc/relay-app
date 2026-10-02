import {
  opened,
  chatTime,
  isLegacyGeneral,
  isMailKey,
  LEGACY_BOARD,
  isTerminal,
  boardKey,
} from "../domain/navigation/keys";
import { WAIT, PRS, MAIL, isView } from "../domain/navigation/views";
import type { Settings } from "../domain/settings/types";
import * as backend from "../infrastructure/backend";
import { storage } from "../infrastructure/storage";
import { applyTheme } from "../infrastructure/window";
import { ghOn, initLanguage, mailOn, setSettingsState, settings } from "./settings/settings";
import { loadSnapshot, project, refreshIcons, reloadIcons, checkFavicons } from "./workspace/vault";
import { onboard } from "./workspace/vault-setup";
import { useConversationsStore } from "./conversations/store";
import { saveChats, newChat } from "./conversations/chats";
import { terminalOf } from "./conversations/selectors";
import { onAgentEvent } from "./conversations/events";
import { ensureHistory, tailTerm, tailOutside } from "./conversations/history";
import { pollPending, pollAgents, pollSubs, agentsStale, setSessions } from "./conversations/polls";
import { closeChat } from "./conversations/actions";
import { loadAgents, sawDefaults } from "./agents/agents";
import { useNavigationStore } from "./navigation/store";
import { select, newHere } from "./navigation/navigation";
import { closeDrawer } from "./navigation/panel";
import { useBoardStore } from "./board/store";
import { checkBoards, resetBoard } from "./board/board";
import { loadPrs, resetPrs, loadProjectRepos, askRepo } from "./pull-requests/prs";
import { loadMails, resetMail, mailLinkClicked } from "./mail/mail";
import { startUsage, reloadUsage } from "./usage/usage";
import { loadMeetings, tick } from "./calendar/calendar";
import { listenToLinks } from "./deep-links";

// The main window's start: listeners first, then settings, language and vault, then the conversations from earlier
// versions, then the polls. Every poll of the app starts here, once.
const selected = () => useNavigationStore.getState().selected;
const cs = () => useConversationsStore.getState();

// a board the sidebar no longer shows: its integration was switched off or lost its token
const boardDown = (key: string) => {
  const view = opened(key);
  return view.kind === "board" && !useBoardStore.getState().ready.includes(view.provider);
};
const sameJson = (first: unknown, second: unknown) => JSON.stringify(first) === JSON.stringify(second);

// the settings window saved: follow it here
async function settingsChanged(next: Settings) {
  const was = settings();
  const languageChanged = next.language !== was.language;
  const integrationsChanged = !sameJson(next.integrations, was.integrations);
  const githubChanged = !sameJson(next.github, was.github);
  const mailChanged = !sameJson(next.mail, was.mail);
  const calendarChanged = !sameJson(next.calendar, was.calendar);
  setSettingsState(next);
  applyTheme(next.theme, next.accent);
  // a new language applies without a restart. The board drops its cache: task labels are built in the language
  if (integrationsChanged || languageChanged) resetBoard();
  if (languageChanged) await initLanguage();
  if (githubChanged) {
    resetPrs();
    if (!ghOn() && selected() === PRS) select(WAIT);
    loadPrs();
    loadProjectRepos();
  }
  if (mailChanged) {
    resetMail();
    if (isMailKey(useNavigationStore.getState().panel.open)) closeDrawer();
    if (!mailOn() && selected() === MAIL) select(WAIT);
    loadMails();
  }
  if (calendarChanged) loadMeetings();
  checkBoards().then(() => {
    if (boardDown(selected())) select(WAIT);
    loadSnapshot();
  });
  // the agents bring the commands and skills of the vault with them
  loadAgents().then(reloadUsage);
}

export async function boot() {
  listenToBackend();
  await loadSettingsAndVault();
  await adoptEarlierConversations();
  await pickStartView();
  listenToLinks();
  startPolls();
}

function listenToBackend() {
  backend.onAgent((key, event, provider) =>
    event.type === "resolved" ? sawDefaults(provider, event) : onAgentEvent(key, event, provider),
  );
  backend.onOpenChat(select);
  backend.onMailLink(mailLinkClicked);
  backend.onSettingsChanged(settingsChanged);
  backend.onMenu(onMenu);
}

// the Gesprek menu: Cmd-T general, Cmd-N in the current project, Cmd-W closes the open conversation
function onMenu(item: string) {
  if (item === "new-general") select(newChat(null));
  else if (item === "new-project") newHere();
  else if (item === "close-chat" && !isView(selected()) && !cs().chats[selected()]?.draft) closeChat(selected());
}

async function loadSettingsAndVault() {
  try {
    setSettingsState(await backend.getSettings());
  } catch {
    /* older backend */
  }
  await initLanguage();
  applyTheme(settings().theme, settings().accent);
  // no vault yet, or the configured one is gone: choose one before anything reads it
  const vaultStatus = await backend.vaultStatus();
  if (!vaultStatus.ok) {
    await onboard(vaultStatus);
    setSettingsState(await backend.getSettings());
  }
  await loadSnapshot();
  await refreshIcons();
  backend.onIconsChanged(reloadIcons);
  backend.onReposChanged(loadProjectRepos);
  backend.onRepoUnlinked(askRepo);
}

// conversations from earlier versions: general:<id>, plain project names
async function adoptLegacyKeys() {
  const oldGenerals = storage.get<Record<string, { title: string; at: number }>>("gens", {});
  const keys = await backend.chats();
  useConversationsStore.setState(draft => {
    for (const key of keys) {
      if (draft.chats[key]) continue;
      if (isLegacyGeneral(key)) {
        draft.chats[key] = {
          key,
          project: null,
          title: oldGenerals[key]?.title || "Algemeen gesprek",
          at: oldGenerals[key]?.at || chatTime(key),
        };
      } else if (project(key)) draft.chats[key] = { key, project: key, title: "Gesprek", at: 0 };
      else draft.chats[key] = { key, project: null, title: "Gesprek", at: chatTime(key) };
    }
  });
}

// the agent of each conversation with a session, from sessions.json (entries from before the providers are Claude's)
async function adoptProviders() {
  const providers = await backend.chatProviders().catch(() => ({}) as Record<string, string>);
  useConversationsStore.setState(draft => {
    for (const [key, provider] of Object.entries(providers)) {
      if (draft.chats[key]) draft.chats[key].provider = provider;
    }
  });
}

async function adoptEarlierConversations() {
  await adoptLegacyKeys();
  await adoptProviders();
  saveChats();
  loadAgents();
  const untitled = Object.values(cs().chats).filter(conversation =>
    ["Gesprek", "Algemeen gesprek"].includes(conversation.title),
  );
  await Promise.all(untitled.map(conversation => ensureHistory(conversation.key)));
  await pollAgents();
  await checkBoards();
}

// the open view is gone (conversation removed, board or integration switched off): start on the waiting view
const selectedIsGone = () => {
  const key = selected();
  return (
    (!isView(key) && !cs().chats[key] && !terminalOf(key)) ||
    boardDown(key) ||
    (key === PRS && !ghOn()) ||
    (key === MAIL && !mailOn())
  );
};

async function pickStartView() {
  // the one board before the providers
  if (selected() === LEGACY_BOARD)
    useNavigationStore.setState(draft => {
      draft.selected = boardKey("productive");
    });
  if (selectedIsGone())
    useNavigationStore.setState(draft => {
      draft.selected = WAIT;
    });
  await select(selected());
}

// a terminal conversation that is open in the app: new transcript lines and its busy state every 2 s
async function followOpenTerminal() {
  if (!isTerminal(selected())) return;
  const [, agentsList] = await Promise.all([tailTerm(selected()), backend.agents()]);
  setSessions({ agentsList });
}

// while one runs outside: its transcript every 2 s, and the providers' sessions every 4 s to see the turn end
async function followOutsideTurns() {
  const keys = Object.keys(cs().outside);
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
  backend.onRemindersChanged(loadSnapshot);
  setInterval(checkFavicons, 60 * 60000); // a project new in work-state gets its icon within the hour
  if (selected() !== PRS) loadPrs(); // select() already loads it when the view is open
  setInterval(loadPrs, 5 * 60000);
  startUsage(); // plan limits for the sidebar, tokens while the view is open
  if (selected() !== MAIL) loadMails();
  setInterval(loadMails, 5 * 60000);
  loadMeetings(); // the meetings about to start, under Waiting, with a banner 5 minutes before
  setInterval(loadMeetings, 5 * 60000);
  setInterval(tick, 30000);
}
