import { VIEW, opened } from "./keys.ts";

// What the middle column shows: a view, a provider's board, a terminal session or an app conversation.
export const {
  wait: WAIT,
  reminders: REM,
  prs: PRS,
  mail: MAIL,
  graph: GRAPH,
  usage: USAGE,
  inbox: INBOX_VIEW,
  collection: COLLECTION_VIEW,
  servers: SERVERS,
} = VIEW;

/** The id of the provider whose board a selection key opens (application/navigation's `boardOf` gives the provider). */
export const boardIdOf = (key: string) => {
  const view = opened(key);
  return view.kind === "board" ? view.provider : undefined;
};
/** A view, a board, a plugin's view, a page, a review of Today's work in progress or a meeting: no conversation, no composer. */
export const isView = (key: string) => {
  const target = opened(key);
  return (
    target.kind === "view" ||
    target.kind === "board" ||
    target.kind === "plugin" ||
    target.kind === "page" ||
    (target.kind === "work" && (target.work === "review" || target.work === "meeting"))
  );
};
/** The id of the plugin whose view a selection key opens, undefined for any other key. */
export const pluginIdOf = (key: string) => {
  const view = opened(key);
  return view.kind === "plugin" ? view.id : undefined;
};
/** The Today item a review view is about, "" for any other key. */
export const reviewOf = (key: string) => {
  const target = opened(key);
  return target.kind === "work" && target.work === "review" ? target.id : "";
};
/** The meeting a Meeting view key is about (its calendar event id), "" for any other key. */
export const meetingOf = (key: string) => {
  const target = opened(key);
  return target.kind === "work" && target.work === "meeting" ? target.id : "";
};
/** What the right drawer shows, "" while it is closed: one of the project's tools, the open conversation's changes,
 *  the orchestrator's workers, or an Artifact the conversation published. */
export type Drawer = "" | TabId | "workers" | "agents" | "artifact";
/** The project panel's tabs (ui/features/drawer/tabs): the drawer shows one of them under a strip of them all. */
export const TAB_IDS = ["prs", "builds", "security", "git", "files", "terminal"] as const;
export type TabId = (typeof TAB_IDS)[number];
export const isTab = (drawer: Drawer): drawer is TabId => (TAB_IDS as readonly string[]).includes(drawer);
/** What a tab says about its project: something failed, something waits on you, something runs. Nothing is null. */
export type Attention = "fail" | "you" | "busy" | null;
/** The most pressing of several, in the order they are shown: failed, waiting on you, running. */
export const ATTENTION: readonly NonNullable<Attention>[] = ["fail", "you", "busy"];
export const worstOf = (all: Attention[]): Attention => ATTENTION.find(a => all.includes(a)) ?? null;
/** A conversation's own drawer: its agents or its Artifact. The project's tools (terminal, Git, files) follow whatever
 *  is open instead. */
export const ownDrawer = (drawer: Drawer) => drawer === "agents" || drawer === "artifact";
/** The drawer once another conversation opens while `drawer` is shown: the own drawer that one had open when it was
 *  left (`kept`), else what is shown, unless that belonged to the conversation left. */
export const drawerOn = (drawer: Drawer, kept: Drawer | undefined): Drawer => kept || (ownDrawer(drawer) ? "" : drawer);
/** A project's board or PRs opened from its title bar: whose they are, and the conversation to go back to. */
export type Tool = { project: string; back: string };
/** `detail`: a second, quieter line; a toast with one is a refusal and shows the red mark. */
export type Toast = { text: string; undo?: () => void; btn?: string; detail?: string };
/** The note a page key shows, "" for any other key. */
export const pageOf = (key: string) => {
  const target = opened(key);
  return target.kind === "page" ? target.target : "";
};
/** What a page goes back to: what was open before it (a conversation or a view), the drawer that had, and where its
 *  log was scrolled (null: at the bottom). */
export type Back = { key: string; tool: Tool | null; drawer: Drawer; top: number | null };
/** Back once `to` opens from `from` (what is open now): a page opened from anything but a page goes back to it, one
 *  opened from a page keeps that page's Back (one level), anything else has none. */
export const backAfter = (back: Back | null, from: Back, to: string): Back | null =>
  !pageOf(to) ? null : pageOf(from.key) || from.key === to ? back : from;
