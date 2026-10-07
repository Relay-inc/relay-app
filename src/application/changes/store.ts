import type { LineComment, RepoChanges } from "../../domain/conversations/changes";
import { makeStore } from "../make-store";

type ChangesState = {
  key: string; // the conversation whose changes are loaded
  repos: RepoChanges[] | null; // null while loading
  err: string;
  open: string; // the file shown, "repo\npath", "" for the list
  line: string; // the line a comment is being written on, "side:line", "" for none
  draft: string;
  comments: Record<string, LineComment[]>; // per conversation, until sent
};

export const useChangesStore = makeStore<ChangesState>(() => ({
  key: "",
  repos: null,
  err: "",
  open: "",
  line: "",
  draft: "",
  comments: {},
}));
