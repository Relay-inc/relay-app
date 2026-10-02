import { ls } from "../core/store";
import { provider } from "./providers";
import { VIEW, opened, boardKey, isTerminal } from "./keys";

// What the main window shows: the open conversation or view (`sel`), the right drawer, and the overlays.

export const { wait: WAIT, reminders: REM, prs: PRS, mail: MAIL, usage: USAGE } = VIEW;
export { boardKey, isTerminal };

export type Drawer = "" | "detail" | "terminal" | "notes";

export const ui = {
  selected: ls.get<string>("sel", "") || WAIT,
  drawer: "" as Drawer, // the right drawer: what it shows, "" while closed
  projectPanel: false, // the conversation's project panel under the title
  toast: null as { text: string; undo?: () => void; btn?: string } | null,
  zoom: "", // the image shown large
  quickAsk: false, // Cmd-K
  // the project's board or PRs opened from the title bar: whose they are, and the conversation to go back to
  tool: null as { project: string; back: string } | null,
  lastProject: null as string | null, // the vault project last shown, so its linked board opens with the board view
};

/** The provider whose board a selection key opens. */
export const boardOf = (key: string) => {
  const view = opened(key);
  return view.kind === "board" ? provider(view.provider) : undefined;
};
export const isView = (key: string) => {
  const kind = opened(key).kind;
  return kind === "view" || kind === "board";
};
