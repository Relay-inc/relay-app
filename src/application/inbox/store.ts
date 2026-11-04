import type * as backend from "../../infrastructure/backend";
import type { FilingItem, InboxNote } from "../../domain/inbox/rules";
import { makeStore } from "../make-store";

// The Inbox's state (inbox.ts): the notes per workspace, Claude's proposals, and the row being edited.
export type PendingMove = backend.ScratchMove;
type Proposal = { at: number; items: FilingItem[] };
type InboxState = {
  notes: Record<string, InboxNote[]>; // per workspace folder
  proposal: Record<string, Proposal | undefined>;
  skipped: string[]; // notes the user left alone this time
  busy: "" | "propose" | "accept";
  /** the note whose destination is being edited, and the folder picked so far */
  edit: { path: string; dest: string } | null;
  home: Record<string, string | null>; // a type's home folder, by `<workspace>\n<type>`
  /** old scratch notes still outside the vault, per workspace: what the migration would move */
  pending: Record<string, backend.ScratchMove[]>;
  /** bumped when the Inbox changed outside this view: the notes drawer reads its notes again */
  version: number;
};
export const useInboxStore = makeStore<InboxState>(() => ({
  notes: {},
  proposal: {},
  skipped: [],
  busy: "",
  edit: null,
  home: {},
  pending: {},
  version: 0,
}));
