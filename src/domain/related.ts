import { invoke } from "@tauri-apps/api/core";
import { changed } from "../core/store";
import { chat } from "./chats/state";

// Related notes for the open conversation: its last messages go to the vault's full-text index (related_notes),
// again whenever the conversation grows. The answer is kept per conversation.
export type Related = { path: string; title: string; snippet: string };

const asked: Record<string, number> = {}; // conversation key: the message count last asked for
export const related: Record<string, Related[]> = {};

// the user's and the agent's own words, the latest last; tool output is mostly noise
const textOf = (key: string) =>
  (chat.messages[key] || [])
    .filter(item => item.kind === "me" || item.kind === "ai")
    .slice(-8)
    .map(item => item.text)
    .join("\n")
    .slice(-6000);

/** Ask the index again when the conversation has new messages since the last time. */
export async function loadRelated(key: string) {
  const count = chat.messages[key]?.length ?? 0;
  if (!count || asked[key] === count) return;
  asked[key] = count;
  try {
    related[key] = await invoke<Related[]>("related_notes", { text: textOf(key) });
  } catch (e) {
    console.error(e);
    related[key] = [];
  }
  changed();
}
