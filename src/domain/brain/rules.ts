import type { BrainNote } from "./types.ts";

/** A note's key in the view: the same id can exist in two brains. */
export const brainKey = (note: Pick<BrainNote, "brain" | "id">) => `${note.brain}\n${note.id}`;
/** A brain's name: the last folder of its path. */
export const brainName = (path: string) => path.replace(/\/+$/, "").split("/").pop() || path;
/** The notes per brain, in the order the brains first appear. */
export const byBrain = (notes: BrainNote[]) => {
  const groups = new Map<string, BrainNote[]>();
  for (const note of notes) groups.set(note.brain, [...(groups.get(note.brain) ?? []), note]);
  return [...groups];
};
