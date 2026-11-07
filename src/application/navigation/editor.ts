import { storage } from "../../infrastructure/storage";
import { makeStore } from "../make-store";

// How the pages' editor looks to this user, kept over a restart and the same for every page: Show markdown draws the
// markdown the editor hides (page menu, or its key in Settings › Shortcuts).
const SHOW = "showMarkdown";
export const useEditorStore = makeStore<{ showMarkdown: boolean }>(() => ({ showMarkdown: storage.get(SHOW, false) }));

export function setShowMarkdown(on: boolean) {
  useEditorStore.setState(draft => {
    draft.showMarkdown = on;
  });
  storage.set(SHOW, on);
}
export const toggleShowMarkdown = () => setShowMarkdown(!useEditorStore.getState().showMarkdown);
