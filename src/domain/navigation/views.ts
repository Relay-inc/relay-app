import { VIEW, opened } from "./keys.ts";

// What the middle column shows: a view, a provider's board, a terminal session or an app conversation.
export const { wait: WAIT, reminders: REM, prs: PRS, mail: MAIL, usage: USAGE } = VIEW;

/** The id of the provider whose board a selection key opens (application/navigation's `boardOf` gives the provider). */
export const boardIdOf = (key: string) => {
  const view = opened(key);
  return view.kind === "board" ? view.provider : undefined;
};
/** A view or a board: no conversation, no composer. */
export const isView = (key: string) => {
  const kind = opened(key).kind;
  return kind === "view" || kind === "board";
};
/** What the right drawer shows, "" while it is closed: a note's detail, or one of the project's tools. */
export type Drawer = "" | "detail" | "terminal" | "notes";
/** A project's board or PRs opened from its title bar: whose they are, and the conversation to go back to. */
export type Tool = { project: string; back: string };
export type Toast = { text: string; undo?: () => void; btn?: string };
