import { t, tn, type Key } from "../../shared/i18n";
import * as rules from "../../domain/conversations/rules";
import type { Item } from "../../domain/conversations/types";
import type { Project } from "../../domain/workspace/types";
import { isTerminal, termSid } from "../../domain/navigation/keys";
import { WAIT, REM, PRS, MAIL, BRAIN, USAGE, isView, reviewOf } from "../../domain/navigation/views";
import { useWorkspaceStore } from "../workspace/store";
import { useNavigationStore } from "../navigation/store";
import { ghOn, settings } from "../settings/settings";
import { usePullRequestsStore } from "../pull-requests/store";
import { useMailStore } from "../mail/store";
import { unread } from "../../domain/mail/rules";
import { boardOf } from "../navigation/navigation";
import { provider } from "../../shared/plugins";
import { contextTint } from "../navigation/sidebar";
import { agentOf, chatAgent, chatCaps } from "../agents/agents";
import { projectLabel } from "../workspace/vault";
import { soonMeetings } from "../calendar/calendar";
import { machinePick } from "../../domain/settings/machines";
import { ORCH, isOrchKey } from "../../domain/orchestrator/rules";
import { runningWorkers } from "../orchestrator/orchestrator";
import { useConversationsStore } from "./store";
import { useDraftsStore } from "./drafts";
import { useReviewStore } from "../today/review";
import { todayRest } from "../today/today";
import { useBrainStore } from "../brain/store";
import { graphOf } from "../brain/brain";

// Reads over the conversations as they are now, in the UI language set last. Components call them inside
// `useDerived` (ui/hooks), which redraws when what they return changes.
const cs = () => useConversationsStore.getState();

export const displayTitle = (title: string) => rules.displayTitle(title, t);
export const projectOf = (key: string) => rules.projectOf(cs(), key);
export const label = (key: string) => rules.label(cs(), key, t);
/** The agent's session id behind a conversation (`claude --resume <id>`); empty while a new chat has none yet. */
export const sessionIdOf = (key: string) => cs().sidOf[key]?.sid ?? termSid(key);
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
// meetings about to start count too: they sit at the top of Waiting (application/calendar)
export const waitCount = () => rules.waitCount(cs()) + soonMeetings().length;
export const isWaiting = (key: string) => rules.isWaiting(cs(), key);
export const runningSubs = (key: string) => rules.runningSubs(cs(), key);
/** What was closed under a project, newest first, for "Heropen". */
export const closedOf = (project: string | null) => rules.closedOf(cs(), terminalSessions(true), project, t);
/** The project a general conversation seems to be about, from its items and the projects as given, so a component
 *  memoises it on them (not on every keystroke). */
export const aboutItems = (items: Item[] | undefined, projects: Project[]) =>
  rules.aboutProject({ messages: { about: items ?? [] } }, "about", projects);
export const lastAi = (key: string) => rules.lastAi(cs().messages[key], t);

const VIEW_ICONS: Record<string, string> = {
  [WAIT]: "sun",
  [REM]: "list",
  [PRS]: "pr",
  [MAIL]: "mail",
  [BRAIN]: "brain",
  [ORCH]: "agent",
};

// the phrase after the view's name in the title bar: what needs you now
function viewSummary(key: string) {
  if (key === WAIT) {
    const n = waitCount();
    const rest = todayRest();
    return n ? t("bar.waitingN", { n }) : rest ? t("bar.todayN", { n: rest }) : t("bar.allClear");
  }
  if (key === REM) {
    const reminders = useWorkspaceStore.getState().snap.reminders;
    return t("bar.remCount", { due: reminders.filter(r => r.days <= 0).length, total: reminders.length });
  }
  if (key === PRS) {
    const n = usePullRequestsStore.getState().list?.review.length ?? 0;
    return n ? t("bar.prsReview", { n }) : t("bar.prsNone");
  }
  if (key === MAIL) {
    const list = useMailStore.getState().list;
    if (!list) return "";
    const n = list.filter(unread).length;
    return n ? t("mail.unread", { n }) : t("bar.mailRead");
  }
  if (key === BRAIN) {
    const pending = useBrainStore.getState().notes?.length ?? 0;
    const n = graphOf()?.nodes.length;
    return pending ? t("bar.brainReview", { n: pending }) : n ? t("bar.brainNotes", { n: n.toLocaleString() }) : "";
  }
  if (key === ORCH) {
    const n = runningWorkers();
    return n ? tn("nav.orchRunning", n) : t("bar.orchIdle");
  }
  return "";
}

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
    [BRAIN]: "nav.brain",
    [REM]: "nav.reminders",
    [WAIT]: "nav.today",
    [ORCH]: "nav.orch",
  };
  // a review of Today's work in progress: named by its PR, under its project
  const review = reviewOf(key) ? useReviewStore.getState().reviews[reviewOf(key)] : undefined;
  const viewName = board
    ? board.name
    : VIEW_NAMES[key]
      ? t(VIEW_NAMES[key])
      : review
        ? `${t("today.kind.review")} ${review.title}`
        : "";
  const linkedRef = toolProject ? settings().boards?.[toolProject] : undefined;
  const linked = linkedRef && provider(linkedRef.provider);
  return {
    heading: tool ? projectLabel(tool.project) : viewName || projectLabel(projectName),
    onView,
    session: session ? { busy: session.status === "busy" } : null,
    projectName,
    img: toolProject ? (useWorkspaceStore.getState().icons[toolProject]?.img ?? "") : "",
    tint: context ? contextTint(context) : ("" as const),
    icon: tool ? "" : (VIEW_ICONS[key] ?? ""),
    title: session ? session.title : label(key),
    renamable: !!conversation,
    // the orchestrator's coordinator reads like a view: its name and what runs, no title, no project to move it to
    coordinator: key === ORCH,
    // the terminal would resume a conversation that touched mail without the app's restrictions
    locked: !!conversation?.fromMail,
    noTerm: onView ? true : session ? session.kind !== "background" : agentOf(chatAgent(key))?.caps.terminal === false,
    // the view's second crumb: the project's view name when opened from a project, else a one-phrase summary
    sub: tool ? viewName : viewSummary(key),
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
/** The composer's "runs on" pick: the machines, the one picked ("" this Mac, null nothing to pick) and why only this
 *  Mac can run it (null when a machine can). Before the first message it is where the conversation will start, after
 *  it where it runs: picking another place then moves it (`moveConversation`). */
export function machineChoice(key: string) {
  const conversation = cs().chats[key];
  const list = cs().machineList;
  const started = !!cs().sidOf[key];
  // the orchestrator's conversations run on this Mac in this version: nothing to pick
  if (isOrchKey(key)) return { list, value: null, why: null, started };
  const why = rules.machineBlock(chatCaps(key), !!conversation?.fromMail);
  if (started) return { list, value: list.length ? (cs().machines[key]?.id ?? "") : null, why, started };
  return { list, value: machinePick(list, useDraftsStore.getState().machine[key], !why), why, started };
}
