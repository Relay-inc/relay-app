// Scratch notes: plain text per project. A note is only a file once it has text.
export type Scratch = {
  key: string; // this session's handle: `id` is null until the first save
  id: string | null; // the file in the vault's .relay/notes
  text: string;
  modified: number; // seconds
};

/** The list line of a note: its first line, "" for an empty one (the view says "Untitled"). */
export const scratchTitle = (text: string) => text.trim().split("\n")[0].slice(0, 80);
