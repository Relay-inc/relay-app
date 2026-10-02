import { t, tn } from "../core/i18n";
import { changed, ls } from "../core/store";
import { ui, WAIT, REM, PRS, MAIL } from "./ui";
import {
  chat,
  chatsOf,
  projectOf,
  terminalSessions,
  waitCount,
  isWaiting,
  runningSubs,
  displayTitle,
  type Chat,
  type TerminalSession,
} from "./chats/state";
import { vault, contexts, projectLabel } from "./vault";
import { config, ghOn, mailOn, saveSettings, type SidebarCfg } from "./config";
import { readyBoards } from "./board";
import { agent, chatAgent } from "./agents";
import { mail, unread } from "./mail";
import { prs } from "./prs";
import type { Project } from "./vault";
import { viewItems, type ViewItem } from "./sidebar-views";
import { arranged, isHidden, place, ordered } from "./sidebar-order";

export { place, ordered };

// The sidebar's own state: the search text, folded sections and projects, and the order the user dragged.
export const sidebar = {
  find: "",
  collapsed: ls.get<Record<string, boolean>>("collapsed", {}),
  unfolded: new Set<string>(), // projects whose conversations past the first five are shown
  secOrder: ls.get<string[]>("secOrder", ["Algemeen"]), // sections,
  projOrder: ls.get<Record<string, string[]>>("projOrder", {}), // projects within a section,
  convOrder: ls.get<Record<string, string[]>>("convOrder", {}), // conversations per project (or "" for Algemeen)
};
export const setFind = (text: string) => {
  sidebar.find = text;
  changed();
};
export function toggleSection(id: string) {
  sidebar.collapsed[id] = !sidebar.collapsed[id];
  ls.set("collapsed", sidebar.collapsed);
  changed();
}
export function toggleUnfold(project: string) {
  if (sidebar.unfolded.has(project)) sidebar.unfolded.delete(project);
  else sidebar.unfolded.add(project);
  changed();
}
/** A drop after dragging: `visible` is the order as shown, the dragged `id` goes before or after `ref`. */
export function reorder(
  kind: "sec" | "proj" | "conv" | "view",
  scope: string,
  visible: string[],
  id: string,
  ref: string,
  after: boolean,
) {
  if (kind === "view") {
    // among all views, the switched-off ones too, so they come back where they were
    setSidebar({
      order: place(
        allViews().map(view => view.key),
        id,
        ref,
        after,
      ),
    });
    return;
  }
  if (kind === "sec") {
    sidebar.secOrder = place(sidebar.secOrder, id, ref, after);
    ls.set("secOrder", sidebar.secOrder);
  } else if (kind === "conv") {
    sidebar.convOrder[scope] = place(visible, id, ref, after);
    ls.set("convOrder", sidebar.convOrder);
  } else {
    sidebar.projOrder[scope] = place(visible, id, ref, after);
    ls.set("projOrder", sidebar.projOrder);
  }
  changed();
}
// ---------- what the sidebar shows, built from the state: the view rows on top, then the sections with their rows
export type Trail = "" | "dot" | "spin";
/** The badge or count at the end of a view row. */
export type Meta = { kind: "badge" | "count" | "late" | "soon"; n: number; title?: string };
export type ViewRow = ViewItem & { meta?: Meta };
export type ConvRow = {
  key: string;
  parent: string;
  term: boolean;
  glyph: string; // the agent's own mark; a terminal session draws the terminal
  title: string;
  selected: boolean;
  unseen: boolean;
  trail: Trail;
  subs: number;
  subsTitle: string;
  closable: boolean;
  closing: boolean;
};
export type ProjectBlock = {
  name: string;
  context: string;
  label: string;
  img?: string | null;
  emoji?: string;
  unseen: boolean;
  trail: Trail;
  addTitle: string;
  convs: ConvRow[];
  fold: string;
};
/** `tint` is the colour of a vault context, `add` the project a new conversation from the header is about ("" for general). */
export type Section = {
  id: string;
  label: string;
  tint: "" | "ctx-a" | "ctx-m" | "ctx-p";
  count: number;
  collapsed: boolean;
  open: boolean;
  add?: string;
  convs: ConvRow[];
  projects: ProjectBlock[];
};

// contexts come from the vault index, in its order, each takes the next of three colours
const CONTEXT_TINTS = ["ctx-a", "ctx-m", "ctx-p"] as const;
/** The colour of a vault context, the same in the sidebar and the title bar. */
export const contextTint = (context: string) =>
  CONTEXT_TINTS[Math.max(0, contexts().indexOf(context)) % CONTEXT_TINTS.length];
export const GENERAL = "Algemeen";
const SHOWN_CONVERSATIONS = 5;

const isOpenDraft = (conversation: Chat, project: string | null) =>
  conversation.draft &&
  !conversation.closed &&
  conversation.project === project &&
  (conversation.key === ui.selected || chat.typed[conversation.key]);
// the open draft shows as "Nieuw gesprek" under its project, its title follows what is typed
const listed = (project: string | null): Chat[] => [
  ...Object.values(chat.chats).filter(conversation => isOpenDraft(conversation, project)),
  ...chatsOf(project),
];
const trailOf = (keys: string[]): Trail => {
  if (keys.some(isWaiting)) return "dot";
  if (keys.some(key => chat.status[key] === "busy")) return "spin";
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
  selected: ui.selected === conversation.key,
  unseen: chat.unseen.has(conversation.key),
  trail: trailOf([conversation.key]),
  ...subsOf(conversation.key),
  closable: !(conversation.draft && !chat.typed[conversation.key]),
  closing: chat.closing.has(conversation.key),
});
const termRow = (session: TerminalSession): ConvRow => ({
  key: session.key,
  parent: session.project ?? "",
  term: true,
  glyph: "",
  title: session.title,
  selected: ui.selected === session.key,
  unseen: false,
  trail: terminalTrail(session),
  ...subsOf(session.key),
  closable: true,
  closing: false,
});

// the label without its emoji when the icon is already shown next to it
const blockLabel = (name: string) =>
  projectLabel(name).replace(/^\S+ (?=.)/, emoji => (config.value.projects[name]?.icon ? "" : emoji));
const foldLabel = (total: number, unfolded: boolean) => {
  if (total <= SHOWN_CONVERSATIONS) return "";
  return unfolded ? t("nav.less") : t("nav.more", { n: total - SHOWN_CONVERSATIONS });
};

function projectBlock(project: Project, allSessions: TerminalSession[]): ProjectBlock {
  const conversations = listed(project.name);
  const sessions = allSessions.filter(session => session.project === project.name);
  const keys = [...conversations.map(conversation => conversation.key), ...sessions.map(session => session.key)];
  const unfolded = sidebar.unfolded.has(project.name);
  const icon = vault.icons[project.name];
  const shownConversations = conversations.slice(0, unfolded ? conversations.length : SHOWN_CONVERSATIONS);
  return {
    name: project.name,
    context: project.context,
    unseen: keys.some(key => chat.unseen.has(key)),
    trail: trailOf(keys),
    addTitle: t("nav.newChatAbout", { name: project.name }),
    label: blockLabel(project.name),
    img: icon?.img,
    emoji: icon?.icon,
    convs: ordered(
      [...sessions.map(termRow), ...shownConversations.map(convRow)],
      row => row.key,
      sidebar.convOrder[project.name],
    ),
    fold: foldLabel(conversations.length, unfolded),
  };
}

// ---------- the view rows: waiting, reminders, the boards, pull requests and mail, in the user's order
const waitingMeta = (): Meta | undefined => {
  const waiting = waitCount();
  return waiting ? { kind: "badge", n: waiting } : undefined;
};
const remindersMeta = (): Meta | undefined => {
  const reminders = vault.snap.reminders;
  const due = reminders.filter(reminder => reminder.days <= 0).length;
  const overdue = reminders.some(reminder => reminder.days < 0);
  return due ? { kind: overdue ? "late" : "soon", n: due } : undefined;
};
const prsMeta = (): Meta | undefined => {
  const review = prs.list?.review.length ?? 0;
  return review ? { kind: "count", n: review, title: t("nav.prsReview") } : undefined;
};
const mailMeta = (): Meta | undefined => {
  const unreadCount = mail.list?.filter(unread).length ?? 0;
  return unreadCount ? { kind: "count", n: unreadCount } : undefined;
};
const META: Record<string, () => Meta | undefined> = {
  [WAIT]: waitingMeta,
  [REM]: remindersMeta,
  [PRS]: prsMeta,
  [MAIL]: mailMeta,
};

export const sidebarCfg = (): SidebarCfg => config.value.sidebar ?? {};
export const viewsLayout = () => sidebarCfg().layout ?? "list";
/** Every view there is now, in the user's order, the switched-off ones included. */
export const allViews = () => arranged(viewItems(readyBoards(), ghOn(), mailOn()), sidebarCfg());
export const hiddenViews = () => allViews().filter(view => isHidden(view.key, sidebarCfg()));
const viewRows = (): ViewRow[] =>
  allViews()
    .filter(view => !isHidden(view.key, sidebarCfg()))
    .map(view => ({ ...view, meta: META[view.key]?.() }));

/** Changes the sidebar's settings: shown at once, then saved (the settings window follows). */
export function setSidebar(patch: SidebarCfg) {
  const next = { ...config.value, sidebar: { ...sidebarCfg(), ...patch } };
  config.value = next;
  changed();
  saveSettings(next).then(changed);
}
export const setViewHidden = (key: string, hidden: boolean) =>
  setSidebar({ hidden: [...(sidebarCfg().hidden ?? []).filter(x => x !== key), ...(hidden ? [key] : [])] });

// ---------- the sections
const section = (id: string, query: string, rest: Omit<Section, "id" | "collapsed" | "open">): Section => ({
  id,
  collapsed: !!sidebar.collapsed[id],
  open: !sidebar.collapsed[id] || !!query,
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
      sidebar.convOrder[""],
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
  const candidates = vault.snap.projects.filter(
    (project: Project) =>
      project.context === context &&
      matchesQuery(project, query) &&
      (query || hasOpenWork(project, sessions) || project.name === selectedProject),
  );
  // manual order from dragging comes first, the rest follows by recency
  const shown = ordered(
    candidates,
    (project: Project) => project.name,
    sidebar.projOrder[context],
    (a: Project, b: Project) => lastActivity(b.name, sessions) - lastActivity(a.name, sessions),
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

export function sidebarModel(): { views: ViewRow[]; sections: Section[] } {
  const query = sidebar.find.toLowerCase();
  const selectedProject = projectOf(ui.selected);
  const sessions = terminalSessions();
  const byId: Record<string, Section> = { [GENERAL]: generalSection(query, sessions) };
  contexts().forEach((context, index) => {
    const built = contextSection(context, index, query, sessions, selectedProject);
    if (built) byId[context] = built;
  });
  // sections the user never dragged follow in the index order
  const ids = [...sidebar.secOrder, ...Object.keys(byId).filter(id => !sidebar.secOrder.includes(id))];
  return { views: viewRows(), sections: ids.filter(id => byId[id]).map(id => byId[id]) };
}
