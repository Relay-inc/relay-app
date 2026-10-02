import type { BoardRef } from "../../domain/board/types";
import { WAIT, type Drawer, type Tool, type Toast } from "../../domain/navigation/views";
import { storage } from "../../infrastructure/storage";
import { makeStore } from "../make-store";

/** Moving around the main window: what is open, the right drawer and its detail, the overlays, and the sidebar's own state. */
type NavigationState = {
  selected: string; // the open conversation or view (`sel`)
  drawer: Drawer; // the right drawer: what it shows, "" while closed
  tool: Tool | null; // set while a project's board or PRs, opened from its title bar, is what the middle column shows
  projectPanel: boolean; // the conversation's project panel under the title
  toast: Toast | null;
  zoom: string; // the image shown large
  quickAsk: boolean; // Cmd-K
  quickText: string; // what Cmd-K opens with typed (a relay://ask link), "" for an empty field
  lastProject: string | null; // the vault project last shown, so its linked board opens with the board view
  // The details: a vault note ("note:…") in the right drawer. A PR and a mail open next to their list, a card in the
  // ticket window over the board.
  panel: {
    open: string; // the key of the note shown in the drawer, "" for none
    modal: string; // the card key shown in the ticket window over the board, "" for none
    prOpen: string; // the PR key shown in the Pull requests view, "" for none
    mailOpen: string; // the mail key shown in the Mail view, "" for none
    detail: Record<string, unknown>; // the last answer per key: shown at once, a fresh one follows
    err: string;
    cardRefs: Record<string, BoardRef>;
    acting: boolean; // a card action (comment, status, files) is running: the panel is inert meanwhile
    actErr: string;
  };
  // the sidebar: the search text, folded sections and projects, and the order the user dragged
  sidebar: {
    find: string;
    collapsed: Record<string, boolean>;
    unfolded: Set<string>; // projects whose conversations past the first five are shown
    secOrder: string[]; // sections
    projOrder: Record<string, string[]>; // projects within a section
    convOrder: Record<string, string[]>; // conversations per project (or "" for Algemeen)
  };
};

export const useNavigationStore = makeStore<NavigationState>(() => ({
  selected: storage.get<string>("sel", "") || WAIT,
  drawer: "",
  tool: null,
  projectPanel: false,
  toast: null,
  zoom: "",
  quickAsk: false,
  quickText: "",
  lastProject: null,
  panel: {
    open: "",
    modal: "",
    prOpen: "",
    mailOpen: "",
    detail: {},
    err: "",
    cardRefs: {},
    acting: false,
    actErr: "",
  },
  sidebar: {
    find: "",
    collapsed: storage.get<Record<string, boolean>>("collapsed", {}),
    unfolded: new Set(),
    secOrder: storage.get<string[]>("secOrder", ["Algemeen"]),
    projOrder: storage.get<Record<string, string[]>>("projOrder", {}),
    convOrder: storage.get<Record<string, string[]>>("convOrder", {}),
  },
}));
