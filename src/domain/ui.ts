import { ls } from "../core/store";
import { provider } from "./providers";
import { VIEW, opened, boardKey, isTerm } from "./keys";

// What the main window shows: the open conversation or view (`sel`), the right panel's tab, and the overlays.

export const { wait: WAIT, reminders: REM, prs: PRS, mail: MAIL, usage: USAGE } = VIEW;
export { boardKey, isTerm };

export const ui = {
  sel: ls.get<string>("sel", "") || WAIT,
  tab: "open", // the right panel: open | stand | rem | prs
  noinsp: ls.get<boolean>("noinsp", false), // the right panel folded away
  pop: false, // the conversation's project panel under the title
  toast: null as { text: string; undo?: () => void; btn?: string } | null,
  zoom: "", // the image shown large
  qk: false, // Cmd-K
  lastP: null as string | null, // the vault project last shown, so its linked board opens with the board view
};

/** The provider whose board a selection key opens. */
export const boardOf = (key: string) => {
  const o = opened(key);
  return o.kind === "board" ? provider(o.provider) : undefined;
};
export const isView = (key: string) => {
  const kind = opened(key).kind;
  return kind === "view" || kind === "board";
};
