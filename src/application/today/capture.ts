import { isTerminal } from "../../domain/navigation/keys";
import { ORCH } from "../../domain/orchestrator/rules";
import * as backend from "../../infrastructure/backend";
import { settings } from "../settings/settings";
import { useConversationsStore } from "../conversations/store";

// Closing a conversation: Claude reads it once more and writes what belongs in the vault straight in (lib.rs
// capture_vault). Nothing is shown or asked; the vault's git history is the review. Off with Settings › General.

/** User messages before a conversation is worth reading on close: a quick question has nothing for the vault. */
const MIN_TURNS = 3;

// one at a time: closing all of a project's conversations must not start a Claude for each at once
let queue: Promise<unknown> = Promise.resolve();

/** Write what a conversation that just closed leaves for the vault, in the queue. Skipped for terminals, the
 *  coordinator, a conversation about mail (its text is not the user's) and one shorter than MIN_TURNS user messages.
 *  ponytail: counts the messages loaded in the app; a conversation closed without ever being opened this run counts 0 */
export function captureOnClose(key: string) {
  const { chats, messages } = useConversationsStore.getState();
  const chat = chats[key];
  if (settings().captureOnClose === false || isTerminal(key) || key === ORCH || !chat || chat.fromMail) return;
  if ((messages[key] ?? []).filter(message => message.kind === "me").length < MIN_TURNS) return;
  queue = queue.then(() => backend.captureVault(key).catch(error => console.error("capture", error)));
}
