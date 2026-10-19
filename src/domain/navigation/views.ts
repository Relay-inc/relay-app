import { VIEW, opened } from "./keys.ts";

// What the middle column shows: a view, a provider's board, a terminal session or an app conversation.
export const { wait: WAIT, reminders: REM, prs: PRS, mail: MAIL, brain: BRAIN, usage: USAGE } = VIEW;

/** The id of the provider whose board a selection key opens (application/navigation's `boardOf` gives the provider). */
export const boardIdOf = (key: string) => {
  const view = opened(key);
  return view.kind === "board" ? view.provider : undefined;
};
/** A view, a board, a plugin's view, or a review of Today's work in progress: no conversation, no composer. */
export const isView = (key: string) => {
  const target = opened(key);
  return (
    target.kind === "view" ||
    target.kind === "board" ||
    target.kind === "plugin" ||
    (target.kind === "work" && target.work === "review")
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
/** What the right drawer shows, "" while it is closed: a note's detail, one of the project's tools, the open
 *  conversation's changes, or the orchestrator's workers. */
export type Drawer = "" | "detail" | "terminal" | "notes" | "design" | "workers" | "changes" | "agents";
/** A project's board or PRs opened from its title bar: whose they are, and the conversation to go back to. */
export type Tool = { project: string; back: string };
export type Toast = { text: string; undo?: () => void; btn?: string };
