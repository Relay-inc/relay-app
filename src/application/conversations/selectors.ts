import { t, type Key } from "../../shared/i18n";
import * as rules from "../../domain/conversations/rules";
import type { Item } from "../../domain/conversations/types";
import type { Project } from "../../domain/workspace/types";
import { isTerminal } from "../../domain/navigation/keys";
import { WAIT, REM, PRS, MAIL, USAGE, isView } from "../../domain/navigation/views";
import { useWorkspaceStore } from "../workspace/store";
import { useNavigationStore } from "../navigation/store";
import { ghOn, settings } from "../settings/settings";
import { usePullRequestsStore } from "../pull-requests/store";
import { boardOf } from "../navigation/navigation";
import { provider } from "../../shared/plugins";
import { contextTint } from "../navigation/sidebar";
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
/** The slash commands and skills of a conversation's agent, for the composer's completion. */
export const commandsOf = (key: string) => cs().commands[chatAgent(key)] ?? [];
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
 *  the project and its image, the editable title, what the terminal button may do, and the project's tools. */
export function chatBar(key: string) {
  const onView = isView(key);
  const session = !onView && isTerminal(key) ? terminalOf(key) : undefined;
  // the project of the open conversation or terminal session, null for a general one and for a view
  const projectName = session ? session.project : onView ? null : projectOf(key);
  const conversation = cs().chats[key];
  const board = boardOf(key);
  // a project's board or PRs opened from its title bar reads as that project's: its name first, the view as the subtitle
  const tool = onView ? useNavigationStore.getState().tool : null;
  const toolProject = projectName ?? tool?.project ?? null;
  const context = toolProject
    ? useWorkspaceStore.getState().snap.projects.find(p => p.name === toolProject)?.context
    : "";
  const VIEW_NAMES: Record<string, Key> = {
    [PRS]: "nav.prs",
    [USAGE]: "nav.usage",
    [MAIL]: "nav.mail",
    [REM]: "nav.reminders",
    [WAIT]: "nav.waiting",
  };
  const viewName = board ? board.name : VIEW_NAMES[key] ? t(VIEW_NAMES[key]) : "";
  const linkedRef = toolProject ? settings().boards?.[toolProject] : undefined;
  const linked = linkedRef && provider(linkedRef.provider);
  return {
    heading: tool ? projectLabel(tool.project) : viewName || projectLabel(projectName),
    onView,
    session: session ? { busy: session.status === "busy" } : null,
    projectName,
    img: toolProject ? (useWorkspaceStore.getState().icons[toolProject]?.img ?? "") : "",
    tint: context ? contextTint(context) : ("" as const),
    // an app conversation's turn: idle or busy; "" for a terminal session or a view
    state: conversation ? (cs().status[key] ?? ("idle" as const)) : ("" as const),
    title: session ? session.title : label(key),
    renamable: !!conversation,
    // the terminal would resume a conversation that touched mail without the app's restrictions
    locked: !!conversation?.fromMail,
    noTerm: onView ? true : session ? session.kind !== "background" : agentOf(chatAgent(key))?.caps.terminal === false,
    waiting: tool ? viewName : key === WAIT ? `${waitCount()}` : "",
    // the project's tools: its linked board, GitHub (dimmed while it has no repos) and, in the drawer, terminal and notes
    tools: toolProject
      ? {
          project: toolProject,
          board: linked ? { id: linked.id, name: linked.name, mark: linked.mark } : null,
          github: ghOn(),
          repos: !!usePullRequestsStore.getState().repos[toolProject]?.length,
          active: tool ? (board ? ("board" as const) : key === PRS ? ("prs" as const) : ("" as const)) : ("" as const),
          back: !!tool,
        }
      : null,
  };
}
