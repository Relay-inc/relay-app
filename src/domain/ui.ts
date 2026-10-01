import { ls } from "../core/store";
import { provider } from "./providers";

// What the main window shows: the open conversation or view (`sel`), the right panel's tab, and the overlays.

export const USAGE = "__usage",
  WAIT = "__wait",
  REM = "__rem",
  BOARD = "__board",
  PRS = "__prs",
  MAIL = "__mail";
export const VIEWS = [WAIT, REM, PRS, MAIL, USAGE];

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

// ---------- views and boards: a provider's board is the view "__board:<provider id>"
export const boardKey = (id: string) => `${BOARD}:${id}`;
export const boardOf = (k: string) => (k.startsWith(`${BOARD}:`) ? provider(k.slice(BOARD.length + 1)) : undefined);
export const isView = (k: string) => VIEWS.includes(k) || !!boardOf(k);
export const isTerm = (k: string) => k.startsWith("t:");
