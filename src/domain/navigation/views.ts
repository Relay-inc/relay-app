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
 *  or the orchestrator's workers. */
export type Drawer = "" | "terminal" | "notes" | "design" | "workers" | "git" | "files" | "agents";
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
