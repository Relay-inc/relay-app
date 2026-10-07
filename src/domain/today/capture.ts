// What a closed conversation leaves for the vault: Claude reads it once it closes and proposes changes to notes
// (lib.rs capture_proposals), nothing is written. They wait on Today until the user applies or skips them.

/** One change to the vault: a note (a vault path, existing or new) and what to add or change in it. */
export type Proposal = { title: string; file: string; change: string };
/** The proposals of one closed conversation, kept until applied or skipped. `at`: when it closed, ms. */
export type Capture = { key: string; title: string; project: string | null; at: number; proposals: Proposal[] };

/** User messages before a conversation is worth reading on close: a quick question has nothing for the vault. */
export const MIN_TURNS = 3;

/** The first message of the conversation that applies them: exactly these, in the vault's own way, nothing else. */
export const applyPrompt = (proposals: Proposal[]) =>
  [
    "Apply these changes to the vault, proposed from a conversation that was closed. Follow the vault's rules and " +
      "templates. Read each note first; when it already says something, keep what is there and only add what is " +
      "missing. Change nothing else, and end with the notes you changed.",
    ...proposals.map((p, i) => `${i + 1}. ${p.title} — ${p.file}\n${p.change}`),
  ].join("\n\n");
