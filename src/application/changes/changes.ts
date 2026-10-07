import { commentsMessage, writtenPaths, type RepoChanges } from "../../domain/conversations/changes";
import type { Side } from "../../domain/pull-requests/diff";
import * as backend from "../../infrastructure/backend";
import { useConversationsStore } from "../conversations/store";
import { typedOf } from "../conversations/drafts";
import { typeInto } from "../conversations/actions";
import { useChangesStore } from "./store";

// The changes drawer of a conversation: what git says it changed (domain/conversations/changes.ts), the file open,
// and the comments on its lines that go back to the agent as one message in the composer.
const st = () => useChangesStore.getState();
const set = useChangesStore.setState;

export async function loadChanges(key: string) {
  const fresh = st().key !== key;
  set(draft => {
    draft.key = key;
    draft.err = "";
    if (fresh) {
      draft.repos = null;
      draft.open = "";
      draft.line = "";
      draft.draft = "";
    }
  });
  try {
    const paths = writtenPaths(useConversationsStore.getState().messages[key]);
    const repos = await backend.conversationChanges(key, paths);
    if (st().key === key) set(draft => void (draft.repos = repos));
  } catch (err) {
    if (st().key === key) set(draft => void (draft.err = String(err)));
  }
}

export const openFile = (repo: string, path: string) =>
  set(draft => {
    draft.open = repo || path ? `${repo}\n${path}` : "";
    draft.line = "";
    draft.draft = "";
  });

/** Open or close the comment box on a line ("side:line"). */
export const pickLine = (line: string) =>
  set(draft => {
    draft.line = draft.line === line ? "" : line;
    draft.draft = "";
  });
export const setLineDraft = (text: string) => set(draft => void (draft.draft = text));

let counter = 0;
export function addComment(repo: string, path: string, side: Side, line: number, code: string) {
  const body = st().draft.trim();
  if (!body) return;
  set(draft => {
    (draft.comments[draft.key] ??= []).push({ id: `c${++counter}`, repo, path, line, side, code, body });
    draft.line = "";
    draft.draft = "";
  });
}
export const removeComment = (id: string) =>
  set(draft => {
    draft.comments[draft.key] = (draft.comments[draft.key] ?? []).filter(c => c.id !== id);
  });

/** The comments go in the composer, after what is typed there, for the user to send. */
export function sendComments(repos: RepoChanges[]) {
  const key = st().key;
  const comments = st().comments[key] ?? [];
  if (!comments.length) return;
  const typed = typedOf(key);
  typeInto(key, `${typed ? `${typed}\n\n` : ""}${commentsMessage(comments, repos.length > 1)}`);
  set(draft => void (draft.comments[key] = []));
}
