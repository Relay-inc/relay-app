import type { Item } from "../conversations/types";

// Related notes for a conversation: its last messages are the query for the vault's full-text index.
export type Related = { path: string; title: string; snippet: string };

/** The user's and the agent's own words, the latest last; tool output is mostly noise. */
export const relatedQuery = (items: Item[]) =>
  items
    .filter(item => item.kind === "me" || item.kind === "ai")
    .slice(-8)
    .map(item => item.text)
    .join("\n")
    .slice(-6000);

/** Ask the index again only when the conversation has new messages since the last time. */
export const grew = (count: number, asked: number | undefined) => count > 0 && asked !== count;
