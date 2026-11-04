import { newView, type Row, type SavedView, type View } from "../../domain/collections/rules";
import { makeStore } from "../make-store";

// The collections' state: the notes' rows and the saved views per workspace folder, and the view being looked at.
type CollectionsState = {
  rows: Record<string, Row[]>;
  views: Record<string, SavedView[]>;
  /** what is open: the view with its changes, and the saved view it came from ("" for a built-in one) */
  view: View;
  name: string;
};
export const useCollectionsStore = makeStore<CollectionsState>(() => ({
  rows: {},
  views: {},
  view: newView("meetings"),
  name: "",
}));
