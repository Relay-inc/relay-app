import { matchesLabel } from "./search.ts";

// ⌘K as the palette: which text is a question (no results then), which commands it matches and in what order the groups
// are shown, cut to the rows that fit.

/** The most rows ⌘K lists, over all groups. */
export const MAX_ROWS = 8;
/** From this many words, or with a trailing `?`, the text is a question and ⌘K lists nothing. */
const QUESTION_WORDS = 6;

/** Whether the text reads as a question to ask, not a name to look up. */
export const isQuestion = (text: string) => {
  const trimmed = text.trim();
  return trimmed.endsWith("?") || trimmed.split(/\s+/).filter(Boolean).length >= QUESTION_WORDS;
};

/** The commands whose label holds every word of the text, the ones named exactly (any case) first. */
export function matchCommands<T extends { label: string }>(commands: T[], text: string) {
  const exact = text.trim().toLowerCase();
  const found = commands.filter(command => matchesLabel(command.label, text));
  return [
    ...found.filter(command => command.label.toLowerCase() === exact),
    ...found.filter(command => command.label.toLowerCase() !== exact),
  ];
}

/** The groups as shown: the commands' group on top when one is named exactly, and no more than `max` rows in all. */
export function arrange<G extends { id: string; options: unknown[] }>(
  groups: G[],
  exactCommand: boolean,
  max = MAX_ROWS,
): G[] {
  const ordered = exactCommand
    ? [...groups.filter(g => g.id === "commands"), ...groups.filter(g => g.id !== "commands")]
    : groups;
  let room = max;
  return ordered
    .map(group => {
      const options = group.options.slice(0, room);
      room -= options.length;
      return { ...group, options };
    })
    .filter(group => group.options.length);
}
