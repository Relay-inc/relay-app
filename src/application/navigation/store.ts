import type { BoardRef } from "../../domain/board/types";
import { WAIT, type PanelTab, type Toast } from "../../domain/navigation/views";
import { storage } from "../../infrastructure/storage";
import { makeStore } from "../make-store";

/** Moving around the main window: what is open, the right panel and its detail, the overlays, and the sidebar's own state. */
type NavigationState = {
  selected: string; // the open conversation or view (`sel`)
  tab: PanelTab; // the right panel's tab
  panelHidden: boolean; // the right panel folded away
  projectPanel: boolean; // the conversation's project panel under the title
  toast: Toast | null;
  zoom: string; // the image shown large
  quickAsk: boolean; // Cmd-K
  lastProject: string | null; // the vault project last shown, so its linked board opens with the board view
  // The right panel's detail: a PR ("owner/repo#12"), a mail ("mail:…"), a vault note ("note:…") or a board card
  // ("card:<provider>:<id>"). While one is open the panel widens; its tabs are behind it.
  panel: {
    open: string; // the key of what is shown, "" for the tabs
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
  tab: "open",
  panelHidden: storage.get<boolean>("noinsp", false),
  projectPanel: false,
  toast: null,
  zoom: "",
  quickAsk: false,
  lastProject: null,
  panel: { open: "", detail: {}, err: "", cardRefs: {}, acting: false, actErr: "" },
  sidebar: {
    find: "",
    collapsed: storage.get<Record<string, boolean>>("collapsed", {}),
    unfolded: new Set(),
    secOrder: storage.get<string[]>("secOrder", ["Algemeen"]),
    projOrder: storage.get<Record<string, string[]>>("projOrder", {}),
    convOrder: storage.get<Record<string, string[]>>("convOrder", {}),
  },
}));
