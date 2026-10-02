import { t, type Key } from "../../shared/i18n";
import * as rules from "../../domain/conversations/rules";
import type { Item } from "../../domain/conversations/types";
import type { Project } from "../../domain/workspace/types";
import { isTerminal } from "../../domain/navigation/keys";
import { WAIT, REM, PRS, MAIL, USAGE, isView } from "../../domain/navigation/views";
import { useWorkspaceStore } from "../workspace/store";
import { useNavigationStore } from "../navigation/store";
import { settings } from "../settings/settings";
import { boardOf } from "../navigation/navigation";
import { agentOf, chatAgent } from "../agents/agents";
import { projectLabel } from "../workspace/vault";
import { useConversationsStore } from "./store";

// Reads over the conversations as they are now, in the UI language set last. Components call them inside
// `useDerived` (ui/hooks), which redraws when what they return changes.
const cs = () => useConversationsStore.getState();

export const displayTitle = (title: string) => rules.displayTitle(title, t);
export const projectOf = (key: string) => rules.projectOf(cs(), key);
export const label = (key: string) => rules.label(cs(), key, t);
/** A project's open conversations (null: the general ones), newest first. */
export const chatsOf = (project: string | null) => rules.chatsOf(cs(), project);
/** The sessions open in the terminal that the app did not start; `hidden` the ones closed here. */
export const terminalSessions = (hidden = false) =>
  rules.terminalSessions(cs(), useWorkspaceStore.getState().snap.sessions.items, settings().overrides, t, hidden);
export const terminalOf = (key: string) => terminalSessions().find(session => session.key === key);
/** The project of the open conversation, terminal or app. */
export const selectedProject = () => {
  const selected = useNavigationStore.getState().selected;
  return isTerminal(selected) ? (terminalOf(selected)?.project ?? null) : projectOf(selected);
};
export const blockedAgents = () => rules.blockedAgents(cs());
export const waitCount = () => rules.waitCount(cs());
export const isWaiting = (key: string) => rules.isWaiting(cs(), key);
export const runningSubs = (key: string) => rules.runningSubs(cs(), key);
/** What was closed under a project, newest first, for "Heropen". */
export const closedOf = (project: string | null) => rules.closedOf(cs(), terminalSessions(true), project, t);
/** The project a general conversation seems to be about, from its items and the projects as given, so a component
 *  memoises it on them (not on every keystroke). */
export const aboutItems = (items: Item[] | undefined, projects: Project[]) =>
  rules.aboutProject({ messages: { about: items ?? [] } }, "about", projects);
export const lastAi = (key: string) => rules.lastAi(cs().messages[key], t);

/** The middle column's title bar for a selection: the heading (a board's or view's name, else the project's label),
 *  the project and its image, the editable title, and what the terminal button may do. */
export function chatBar(key: string) {
  const onView = isView(key);
  const session = !onView && isTerminal(key) ? terminalOf(key) : undefined;
  // the project of the open conversation or terminal session, null for a general one and for a view
  const projectName = session ? session.project : onView ? null : projectOf(key);
  const conversation = cs().chats[key];
  const board = boardOf(key);
  const VIEW_NAMES: Record<string, Key> = {
    [PRS]: "nav.prs",
    [USAGE]: "nav.usage",
    [MAIL]: "nav.mail",
    [REM]: "nav.reminders",
    [WAIT]: "nav.waiting",
  };
  return {
    heading: board ? board.name : VIEW_NAMES[key] ? t(VIEW_NAMES[key]) : projectLabel(projectName),
    onView,
    session: session ? { busy: session.status === "busy" } : null,
    projectName,
    img: !onView && projectName ? (useWorkspaceStore.getState().icons[projectName]?.img ?? "") : "",
    title: session ? session.title : label(key),
    renamable: !!conversation,
    // the terminal would resume a conversation that touched mail without the app's restrictions
    locked: !!conversation?.fromMail,
    noTerm: onView ? true : session ? session.kind !== "background" : agentOf(chatAgent(key))?.caps.terminal === false,
    waiting: key === WAIT ? `${waitCount()}` : "",
  };
}
