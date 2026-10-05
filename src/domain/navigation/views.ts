import { VIEW, opened } from "./keys.ts";

// What the middle column shows: a view, a provider's board, a terminal session or an app conversation.
export const { wait: WAIT, reminders: REM, prs: PRS, mail: MAIL, usage: USAGE } = VIEW;

/** The id of the provider whose board a selection key opens (application/navigation's `boardOf` gives the provider). */
export const boardIdOf = (key: string) => {
  const view = opened(key);
  return view.kind === "board" ? view.provider : undefined;
};
/** A view, a board, or a review of Today's work in progress: no conversation, no composer. */
export const isView = (key: string) => {
  const target = opened(key);
  return target.kind === "view" || target.kind === "board" || (target.kind === "work" && target.work === "review");
};
/** The Today item a review view is about, "" for any other key. */
export const reviewOf = (key: string) => {
  const target = opened(key);
  return target.kind === "work" && target.work === "review" ? target.id : "";
};
/** What the right drawer shows, "" while it is closed: a note's detail, one of the project's tools, or the
 *  orchestrator's workers. */
export type Drawer = "" | "detail" | "terminal" | "notes" | "workers";
/** A project's board or PRs opened from its title bar: whose they are, and the conversation to go back to. */
export type Tool = { project: string; back: string };
export type Toast = { text: string; undo?: () => void; btn?: string };
