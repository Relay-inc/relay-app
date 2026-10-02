import { t, tn } from "../../shared/i18n";
import { agent } from "../../shared/plugins";
import {
  CONTEXT_TINTS,
  GENERAL,
  SHOWN_CONVERSATIONS,
  ordered,
  place,
  type ConvRow,
  type ProjectBlock,
  type ReorderKind,
  type Section,
  type SidebarModel,
  type Trail,
  type ViewRow,
} from "../../domain/navigation/sidebar";
import { WAIT, REM, PRS, MAIL } from "../../domain/navigation/views";
import type { Chat, TerminalSession } from "../../domain/conversations/types";
import type { Project } from "../../domain/workspace/types";
import { unread } from "../../domain/mail/rules";
import { storage } from "../../infrastructure/storage";
import { useConversationsStore } from "../conversations/store";
import { typedOf } from "../conversations/drafts";
import {
  chatsOf,
  displayTitle,
  isWaiting,
  projectOf,
  runningSubs,
  terminalSessions,
  waitCount,
} from "../conversations/selectors";
import { chatAgent } from "../agents/agents";
import { useWorkspaceStore } from "../workspace/store";
import { contexts, projectLabel } from "../workspace/vault";
import { ghOn, mailOn, settings } from "../settings/settings";
import { readyBoards } from "../board/board";
import { useMailStore } from "../mail/store";
import { usePullRequestsStore } from "../pull-requests/store";
import { useNavigationStore } from "./store";
import { boardKey } from "../../domain/navigation/keys";

// The sidebar: its own state (search, folds, dragged order) and the rows it shows, built from every context's state.
const nav = () => useNavigationStore.getState();
const sb = () => nav().sidebar;
const cs = () => useConversationsStore.getState();
const set = useNavigationStore.setState;

export const setFind = (text: string) =>
  set(draft => {
    draft.sidebar.find = text;
  });
export function toggleSection(id: string) {
  set(draft => {
    draft.sidebar.collapsed[id] = !draft.sidebar.collapsed[id];
  });
  storage.set("collapsed", sb().collapsed);
}
export const toggleUnfold = (project: string) =>
  set(draft => {
    if (draft.sidebar.unfolded.has(project)) draft.sidebar.unfolded.delete(project);
    else draft.sidebar.unfolded.add(project);
  });
/** A drop after dragging: `visible` is the order as shown, the dragged `id` goes before or after `ref`. */
export function reorder(kind: ReorderKind, scope: string, visible: string[], id: string, ref: string, after: boolean) {
  set(draft => {
    if (kind === "sec") draft.sidebar.secOrder = place(draft.sidebar.secOrder, id, ref, after);
    else if (kind === "conv") draft.sidebar.convOrder[scope] = place(visible, id, ref, after);
    else draft.sidebar.projOrder[scope] = place(visible, id, ref, after);
  });
  if (kind === "sec") storage.set("secOrder", sb().secOrder);
  else if (kind === "conv") storage.set("convOrder", sb().convOrder);
  else storage.set("projOrder", sb().projOrder);
}

// ---------- the rows
const isOpenDraft = (conversation: Chat, project: string | null) =>
  conversation.draft &&
  !conversation.closed &&
  conversation.project === project &&
  (conversation.key === nav().selected || !!typedOf(conversation.key));
// the open draft shows as "Nieuw gesprek" under its project, its title follows what is typed
const listed = (project: string | null): Chat[] => [
  ...Object.values(cs().chats).filter(conversation => isOpenDraft(conversation, project)),
  ...chatsOf(project),
];
const trailOf = (keys: string[]): Trail => {
  if (keys.some(isWaiting)) return "dot";
  if (keys.some(key => cs().status[key] === "busy")) return "spin";
  return "";
};
const terminalTrail = (session: TerminalSession): Trail => {
  if (session.status === "busy") return "spin";
  return session.state === "blocked" ? "dot" : "";
};
const subsOf = (key: string) => {
  const count = runningSubs(key);
  return { subs: count, subsTitle: count ? tn("nav.agentsWorking", count) : "" };
};
const convRow = (conversation: Chat): ConvRow => ({
  key: conversation.key,
  parent: conversation.project ?? "",
  term: false,
  glyph: agent(chatAgent(conversation.key))?.glyph ?? "",
  title: displayTitle(conversation.title),
  selected: nav().selected === conversation.key,
  unseen: cs().unseen.has(conversation.key),
  trail: trailOf([conversation.key]),
  ...subsOf(conversation.key),
  // only a draft reads what is typed: a keystroke in a started conversation leaves the sidebar alone
  closable: !(conversation.draft && !typedOf(conversation.key)),
});
const termRow = (session: TerminalSession): ConvRow => ({
  key: session.key,
  parent: session.project ?? "",
  term: true,
  glyph: "",
  title: session.title,
  selected: nav().selected === session.key,
  unseen: false,
  trail: terminalTrail(session),
  ...subsOf(session.key),
  closable: true,
});

// the label without the emoji projectLabel puts in front: the row draws the project's icon next to it already
const blockLabel = (name: string) => settings().projects[name]?.label || name;
const foldLabel = (total: number, unfolded: boolean) => {
  if (total <= SHOWN_CONVERSATIONS) return "";
  return unfolded ? t("nav.less") : t("nav.more", { n: total - SHOWN_CONVERSATIONS });
};

function projectBlock(project: Project, allSessions: TerminalSession[]): ProjectBlock {
  const conversations = listed(project.name);
  const sessions = allSessions.filter(session => session.project === project.name);
  const keys = [...conversations.map(conversation => conversation.key), ...sessions.map(session => session.key)];
  const unfolded = sb().unfolded.has(project.name);
  const icon = useWorkspaceStore.getState().icons[project.name];
  const shownConversations = conversations.slice(0, unfolded ? conversations.length : SHOWN_CONVERSATIONS);
  return {
    name: project.name,
    context: project.context,
    unseen: keys.some(key => cs().unseen.has(key)),
    trail: trailOf(keys),
    addTitle: t("nav.newChatAbout", { name: project.name }),
    label: blockLabel(project.name),
    img: icon?.img,
    emoji: icon?.icon,
    convs: ordered(
      [...sessions.map(termRow), ...shownConversations.map(convRow)],
      row => row.key,
      sb().convOrder[project.name],
    ),
    fold: foldLabel(conversations.length, unfolded),
  };
}

// ---------- the view rows: waiting, reminders, the boards, pull requests and mail
const waitingRow = (): ViewRow => {
  const waiting = waitCount();
  return { key: WAIT, icon: "bell", name: t("nav.waiting"), meta: waiting ? { kind: "badge", n: waiting } : undefined };
};
const remindersRow = (): ViewRow => {
  const reminders = useWorkspaceStore.getState().snap.reminders;
  const due = reminders.filter(reminder => reminder.days <= 0).length;
  const overdue = reminders.some(reminder => reminder.days < 0);
  return {
    key: REM,
    icon: "list",
    name: t("nav.reminders"),
    meta: due ? { kind: overdue ? "late" : "soon", n: due } : undefined,
  };
};
const boardRows = (): ViewRow[] =>
  readyBoards().map(board => ({ key: boardKey(board.id), svg: board.glyph, name: board.name }));
const prsRow = (): ViewRow => {
  const review = usePullRequestsStore.getState().list?.review.length ?? 0;
  return {
    key: PRS,
    icon: "pr",
    name: t("nav.prs"),
    meta: review ? { kind: "count", n: review, title: t("nav.prsReview") } : undefined,
  };
};
const mailRow = (): ViewRow => {
  const unreadCount = useMailStore.getState().list?.filter(unread).length ?? 0;
  return {
    key: MAIL,
    icon: "mail",
    name: t("nav.mail"),
    meta: unreadCount ? { kind: "count", n: unreadCount } : undefined,
  };
};
const viewRows = (): ViewRow[] => [
  waitingRow(),
  remindersRow(),
  ...boardRows(),
  ...(ghOn() ? [prsRow()] : []),
  ...(mailOn() ? [mailRow()] : []),
];

// ---------- the sections
const section = (id: string, query: string, rest: Omit<Section, "id" | "collapsed" | "open">): Section => ({
  id,
  collapsed: !!sb().collapsed[id],
  open: !sb().collapsed[id] || !!query,
  ...rest,
});

function generalSection(query: string, sessions: TerminalSession[]): Section {
  const conversations = listed(null).filter(conversation => !query || conversation.title.toLowerCase().includes(query));
  const generalSessions = sessions.filter(
    session => !session.project && (!query || session.title.toLowerCase().includes(query)),
  );
  return section(GENERAL, query, {
    label: t("general").toUpperCase(),
    tint: "",
    count: conversations.length + generalSessions.length,
    add: "",
    convs: ordered(
      [...conversations.map(convRow), ...generalSessions.map(termRow)],
      row => row.key,
      sb().convOrder[""],
    ),
    projects: [],
  });
}

// an app conversation stays until the user closes it, a terminal session as long as it is open
const hasOpenWork = (project: Project, sessions: TerminalSession[]) =>
  sessions.some(session => session.project === project.name) || chatsOf(project.name).length > 0;
const lastActivity = (name: string, sessions: TerminalSession[]) =>
  Math.max(
    0,
    ...chatsOf(name).map(conversation => conversation.at),
    ...sessions.filter(session => session.project === name).map(session => session.mtime),
  );
const matchesQuery = (project: Project, query: string) =>
  project.name.toLowerCase().includes(query) || projectLabel(project.name).toLowerCase().includes(query);

function contextSection(
  context: string,
  index: number,
  query: string,
  sessions: TerminalSession[],
  selectedProject: string | null,
): Section | undefined {
  const candidates = useWorkspaceStore
    .getState()
    .snap.projects.filter(
      project =>
        project.context === context &&
        matchesQuery(project, query) &&
        (query || hasOpenWork(project, sessions) || project.name === selectedProject),
    );
  // manual order from dragging comes first, the rest follows by recency (each project's read once, not per comparison)
  const last = new Map(candidates.map(project => [project.name, lastActivity(project.name, sessions)]));
  const shown = ordered(
    candidates,
    project => project.name,
    sb().projOrder[context],
    (a, b) => last.get(b.name)! - last.get(a.name)!,
  );
  if (!shown.length) return undefined;
  return section(context, query, {
    label: context.toUpperCase(),
    tint: CONTEXT_TINTS[index % CONTEXT_TINTS.length],
    count: shown.length,
    convs: [],
    projects: shown.map(project => projectBlock(project, sessions)),
  });
}

/** What the sidebar shows: the view rows, then the sections in the user's order. Read it with `useDerived`. */
export function sidebarModel(): SidebarModel {
  const query = sb().find.toLowerCase();
  const selectedProject = projectOf(nav().selected);
  const sessions = terminalSessions();
  const byId: Record<string, Section> = { [GENERAL]: generalSection(query, sessions) };
  contexts().forEach((context, index) => {
    const built = contextSection(context, index, query, sessions, selectedProject);
    if (built) byId[context] = built;
  });
  // sections the user never dragged follow in the index order
  const ids = [...sb().secOrder, ...Object.keys(byId).filter(id => !sb().secOrder.includes(id))];
  return { views: viewRows(), sections: ids.filter(id => byId[id]).map(id => byId[id]) };
}
