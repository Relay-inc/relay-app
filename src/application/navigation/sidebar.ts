import { t, tn } from "../../shared/i18n";
import { agent } from "../../shared/plugins";
import {
  CONTEXT_TINTS,
  GENERAL,
  SHOWN_CONVERSATIONS,
  ordered,
  place,
  type ConvRow,
  type FolderBlock,
  type ProjectBlock,
  type ReorderKind,
  type Section,
  type SidebarModel,
  type Trail,
  type ViewRow,
  type Meta,
} from "../../domain/navigation/sidebar";
import { ORCH } from "../../domain/orchestrator/rules";
import { arranged, isHidden, withHidden } from "../../domain/navigation/sidebar-order";
import { byFolder, newFolderId } from "../../domain/navigation/sidebar-folders";
import type { SidebarCfg } from "../../domain/settings/types";
import { viewItems } from "../../domain/navigation/sidebar-views";
import { shownPlugins } from "../../domain/plugins/rules";
import { WAIT, REM, PRS, MAIL, BRAIN } from "../../domain/navigation/views";
import type { Chat, TerminalSession } from "../../domain/conversations/types";
import type { Project } from "../../domain/workspace/types";
import { unread } from "../../domain/mail/rules";
import { storage } from "../../infrastructure/storage";
import { applyTheme, prefersDark } from "../../infrastructure/window";
import { useConversationsStore } from "../conversations/store";
import { typedOf } from "../conversations/drafts";
import { saveChats } from "../conversations/chats";
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
import { contexts, projectLabel, projectName, shownName } from "../workspace/vault";
import { chatVault } from "../../domain/conversations/rules";
import { activeFolder } from "./workspaces";
import { ghOn, mailOn, saveMainSettings, setSettingsState, settings } from "../settings/settings";
import { readyBoards } from "../board/board";
import { useMailStore } from "../mail/store";
import { useBrainStore } from "../brain/store";
import { usePullRequestsStore } from "../pull-requests/store";
import { runningWorkers } from "../orchestrator/orchestrator";
import { useNavigationStore } from "./store";
import { todayRest } from "../today/today";
import { isOpenWork, workOf } from "../today/work";
import type { Work } from "../../domain/today/work";

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
  set(draft => {
    if (kind === "sec") draft.sidebar.secOrder = place(draft.sidebar.secOrder, id, ref, after);
    else if (kind === "conv") draft.sidebar.convOrder[scope] = place(visible, id, ref, after);
    else draft.sidebar.projOrder[scope] = place(visible, id, ref, after);
  });
  if (kind === "sec") storage.set("secOrder", sb().secOrder);
  else if (kind === "conv") storage.set("convOrder", sb().convOrder);
  else storage.set("projOrder", sb().projOrder);
}

// ---------- folders: per project ("" for Algemeen), their open state in `collapsed` under their id
/** A new folder under the project ("" for Algemeen), its name typed in place at once. */
export function addFolder(scope: string) {
  const id = newFolderId(Date.now());
  set(draft => {
    (draft.sidebar.folders[scope] ??= []).push({ id, name: t("nav.newFolder") });
    draft.sidebar.editing = id;
  });
  storage.set("folders", sb().folders);
}
export const editFolder = (id: string) =>
  set(draft => {
    draft.sidebar.editing = id;
  });
/** The typed name, done: empty keeps the one it had. */
export function renameFolder(id: string, name: string) {
  set(draft => {
    draft.sidebar.editing = "";
    const folder = Object.values(draft.sidebar.folders)
      .flat()
      .find(other => other.id === id);
    if (folder && name.trim()) folder.name = name.trim();
  });
  storage.set("folders", sb().folders);
}
/** The folder goes, its conversations stay under their project. */
export function deleteFolder(id: string) {
  set(draft => {
    for (const scope of Object.keys(draft.sidebar.folders))
      draft.sidebar.folders[scope] = draft.sidebar.folders[scope].filter(folder => folder.id !== id);
    delete draft.sidebar.convOrder[id];
    delete draft.sidebar.collapsed[id];
  });
  useConversationsStore.setState(draft => {
    for (const conversation of Object.values(draft.chats)) if (conversation.folder === id) delete conversation.folder;
  });
  saveChats();
  storage.set("folders", sb().folders);
  storage.set("convOrder", sb().convOrder);
  storage.set("collapsed", sb().collapsed);
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
// `folder`: the folder it is shown in, it is reordered among that folder's conversations
const convRow = (conversation: Chat, folder = ""): ConvRow => ({
  key: conversation.key,
  parent: folder || (conversation.project ?? ""),
  project: conversation.project ?? "",
  folder,
  term: false,
  glyph: agent(chatAgent(conversation.key))?.glyph ?? "",
  title: displayTitle(conversation.title),
  selected: nav().selected === conversation.key,
  unseen: cs().unseen.has(conversation.key),
  trail: trailOf([conversation.key]),
  ...subsOf(conversation.key),
  // only a draft reads what is typed: a keystroke in a started conversation leaves the sidebar alone
  closable: !(conversation.draft && !typedOf(conversation.key)),
  closing: cs().closing.has(conversation.key),
  orch: !!conversation.orch,
});
const WORK_ICON = { review: "pr", mail: "mail", meeting: "cal" } as const;
// a piece of Today's work in progress, as a row under its project
const workRow = (work: Work): ConvRow => ({
  key: work.key,
  parent: work.project ?? "",
  project: work.project ?? "",
  folder: "",
  term: false,
  glyph: "",
  title: work.title,
  selected: isOpenWork(work),
  unseen: false,
  trail: work.busy ? "spin" : "",
  subs: 0,
  subsTitle: "",
  closable: work.closable,
  closing: false,
  orch: false,
  work: true,
  icon: WORK_ICON[work.kind],
});
const termRow = (session: TerminalSession): ConvRow => ({
  key: session.key,
  parent: session.project ?? "",
  project: session.project ?? "",
  folder: "",
  term: true,
  glyph: "",
  title: session.title,
  selected: nav().selected === session.key,
  unseen: false,
  trail: terminalTrail(session),
  ...subsOf(session.key),
  closable: true,
  closing: false,
  orch: false,
});

const foldLabel = (total: number, unfolded: boolean) => {
  if (total <= SHOWN_CONVERSATIONS) return "";
  return unfolded ? t("nav.less") : t("nav.more", { n: total - SHOWN_CONVERSATIONS });
};

// a project's (or Algemeen's) folders with what is in them; with a search an empty one is left out
const folderBlocks = (scope: string, inside: Map<string, Chat[]>, query = ""): FolderBlock[] =>
  (sb().folders[scope] ?? []).flatMap(folder => {
    const conversations = inside.get(folder.id) ?? [];
    const editing = sb().editing === folder.id;
    if (query && !conversations.length && !editing) return [];
    const keys = conversations.map(conversation => conversation.key);
    return [
      {
        id: folder.id,
        project: scope,
        name: folder.name,
        open: !sb().collapsed[folder.id] || !!query,
        editing,
        count: conversations.length,
        unseen: keys.some(key => cs().unseen.has(key)),
        trail: trailOf(keys),
        convs: ordered(
          conversations.map(conversation => convRow(conversation, folder.id)),
          row => row.key,
          sb().convOrder[folder.id],
          undefined,
          true,
        ),
      },
    ];
  });

function projectBlock(project: Project, allSessions: TerminalSession[]): ProjectBlock {
  const conversations = listed(project.name);
  const sessions = allSessions.filter(session => session.project === project.name);
  const keys = [...conversations.map(conversation => conversation.key), ...sessions.map(session => session.key)];
  const unfolded = sb().unfolded.has(project.name);
  const icon = useWorkspaceStore.getState().icons[project.name];
  // what sits in a folder is shown there, the first five of the rest under the project
  const { inside, loose } = byFolder(conversations, conversation => conversation.folder, sb().folders[project.name]);
  const shownConversations = loose.slice(0, unfolded ? loose.length : SHOWN_CONVERSATIONS);
  return {
    name: project.name,
    context: project.context,
    unseen: keys.some(key => cs().unseen.has(key)),
    trail: trailOf(keys),
    addTitle: t("nav.newChatAbout", { name: shownName(project.name) }),
    // the label without the emoji projectLabel puts in front: the row draws the project's icon next to it already
    label: projectName(project.name),
    img: icon?.img,
    emoji: icon?.icon,
    folders: folderBlocks(project.name, inside),
    // what is in progress on Today first, then the sessions and conversations in the user's order
    convs: [
      ...workOf(project.name).map(workRow),
      ...ordered(
        [...sessions.map(termRow), ...shownConversations.map(conversation => convRow(conversation))],
        row => row.key,
        sb().convOrder[project.name],
        undefined,
        true,
      ),
    ],
    fold: foldLabel(loose.length, unfolded),
  };
}

// ---------- the view rows: the orchestrator, waiting, reminders, the boards, pull requests and mail, in the user's order
// Today: a badge for what needs the user now, else a count of the rest of the day
const waitingMeta = (): Meta | undefined => {
  const waiting = waitCount();
  if (waiting) return { kind: "badge", n: waiting };
  const rest = todayRest();
  return rest ? { kind: "count", n: rest } : undefined;
};
const remindersMeta = (): Meta | undefined => {
  const reminders = useWorkspaceStore.getState().snap.reminders;
  const due = reminders.filter(reminder => reminder.days <= 0).length;
  const overdue = reminders.some(reminder => reminder.days < 0);
  return due ? { kind: overdue ? "late" : "soon", n: due } : undefined;
};
const prsMeta = (): Meta | undefined => {
  const review = usePullRequestsStore.getState().list?.review.length ?? 0;
  return review ? { kind: "count", n: review, title: t("nav.prsReview") } : undefined;
};
const mailMeta = (): Meta | undefined => {
  const unreadCount = useMailStore.getState().list?.filter(unread).length ?? 0;
  return unreadCount ? { kind: "count", n: unreadCount } : undefined;
};
const brainMeta = (): Meta | undefined => {
  const pending = useBrainStore.getState().notes?.length ?? 0;
  return pending ? { kind: "count", n: pending, title: t("nav.brainPending") } : undefined;
};
// the orchestrator's coordinator: its running workers
const orchMeta = (): Meta | undefined => {
  const running = runningWorkers();
  return running ? { kind: "count", n: running, title: tn("nav.orchRunning", running) } : undefined;
};
const META: Record<string, () => Meta | undefined> = {
  [ORCH]: orchMeta,
  [WAIT]: waitingMeta,
  [REM]: remindersMeta,
  [PRS]: prsMeta,
  [MAIL]: mailMeta,
  [BRAIN]: brainMeta,
};

export const sidebarCfg = (): SidebarCfg => settings().sidebar ?? {};
export const viewsLayout = () => sidebarCfg().layout ?? "icons";
export const moreOn = () => sidebarCfg().more !== false;
/** Every view there is now, in the user's order, the switched-off ones included. */
const allViews = () =>
  arranged(viewItems(readyBoards(), ghOn(), mailOn(), t, shownPlugins(settings().plugins)), sidebarCfg());
export const hiddenViews = () => allViews().filter(view => isHidden(view.key, sidebarCfg()));
const viewRows = (): ViewRow[] =>
  allViews()
    .filter(view => !isHidden(view.key, sidebarCfg()))
    .map(view => ({
      ...view,
      meta: META[view.key]?.(),
      // the coordinator is a conversation: it shows its working state like one
      ...(view.key === ORCH ? { unseen: cs().unseen.has(ORCH), trail: trailOf([ORCH]) } : {}),
    }));

/** Changes the sidebar's settings: shown at once, then saved (the settings window follows). */
export function setSidebar(patch: SidebarCfg) {
  const next = { ...settings(), sidebar: { ...sidebarCfg(), ...patch } };
  setSettingsState(next);
  void saveMainSettings(next);
}
export const setViewHidden = (key: string, hidden: boolean) =>
  setSidebar({ hidden: withHidden(key, hidden, sidebarCfg()) });
/** The page is dark, so the footer's toggle offers light; system counts as whatever macOS shows now. */
export const isDark = () => {
  const theme = settings().theme ?? "system";
  return theme === "dark" || (theme === "system" && prefersDark());
};
/** The footer's toggle: flips light and dark, shown at once, saved once the switch is over. */
export function toggleTheme() {
  const next = { ...settings(), theme: isDark() ? ("light" as const) : ("dark" as const) };
  const shown = applyTheme(next.theme, next.accent);
  setSettingsState(next);
  void shown.then(() => saveMainSettings(next));
}
/** The colour of a vault context, the same in the sidebar, the title bar and the reminders. */
export const contextTint = (context: string) =>
  CONTEXT_TINTS[Math.max(0, contexts().indexOf(context)) % CONTEXT_TINTS.length];

// ---------- the sections
const section = (id: string, query: string, rest: Omit<Section, "id" | "collapsed" | "open">): Section => ({
  id,
  collapsed: !!sb().collapsed[id],
  open: !sb().collapsed[id] || !!query,
  ...rest,
});

// the general conversations of the workspace shown: run in it, or picked for it before they start
function generalSection(query: string, sessions: TerminalSession[], workspace: string): Section {
  const snap = useWorkspaceStore.getState().snap;
  const conversations = listed(null).filter(
    conversation =>
      chatVault(conversation, snap) === workspace && (!query || conversation.title.toLowerCase().includes(query)),
  );
  // ponytail: a terminal session knows no vault, so the general ones show with the main vault only
  const generalSessions = sessions.filter(
    session =>
      !session.project &&
      workspace === (snap.vault?.vault ?? "") &&
      (!query || session.title.toLowerCase().includes(query)),
  );
  const { inside, loose } = byFolder(conversations, conversation => conversation.folder, sb().folders[""]);
  return section(GENERAL, query, {
    label: t("general").toUpperCase(),
    tint: "",
    count: conversations.length + generalSessions.length,
    add: "",
    folders: folderBlocks("", inside, query),
    convs: [
      ...workOf(null).map(workRow),
      ...ordered(
        [...loose.map(conversation => convRow(conversation)), ...generalSessions.map(termRow)],
        row => row.key,
        sb().convOrder[""],
        undefined,
        true,
      ),
    ],
    projects: [],
  });
}

// an app conversation stays until the user closes it, a terminal session as long as it is open
const hasOpenWork = (project: Project, sessions: TerminalSession[]) =>
  sessions.some(session => session.project === project.name) ||
  chatsOf(project.name).length > 0 ||
  workOf(project.name).length > 0;
const lastActivity = (name: string, sessions: TerminalSession[]) =>
  Math.max(
    0,
    ...chatsOf(name).map(conversation => conversation.at),
    ...sessions.filter(session => session.project === name).map(session => session.mtime),
  );
const matchesQuery = (project: Project, query: string) =>
  shownName(project.name).toLowerCase().includes(query) || projectLabel(project.name).toLowerCase().includes(query);

function contextSection(
  context: string,
  index: number,
  query: string,
  sessions: TerminalSession[],
  selectedProject: string | null,
  workspace: string,
): Section | undefined {
  const { snap } = useWorkspaceStore.getState();
  const candidates = snap.projects.filter(
    project =>
      project.context === context &&
      (project.vault || snap.vault?.vault) === workspace &&
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
    folders: [],
    convs: [],
    projects: shown.map(project => projectBlock(project, sessions)),
  });
}

/** What the sidebar shows: the view rows, then the sections in the user's order. Read it with `useDerived`. */
export function sidebarModel(): SidebarModel {
  const query = sb().find.toLowerCase();
  const selectedProject = projectOf(nav().selected);
  const sessions = terminalSessions();
  const workspace = activeFolder();
  const byId: Record<string, Section> = { [GENERAL]: generalSection(query, sessions, workspace) };
  contexts().forEach((context, index) => {
    const built = contextSection(context, index, query, sessions, selectedProject, workspace);
    if (built) byId[context] = built;
  });
  // sections the user never dragged follow in the index order
  const ids = [...sb().secOrder, ...Object.keys(byId).filter(id => !sb().secOrder.includes(id))];
  return { views: viewRows(), sections: ids.filter(id => byId[id]).map(id => byId[id]) };
}
