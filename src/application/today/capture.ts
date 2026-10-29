import { isTerminal } from "../../domain/navigation/keys";
import { ORCH } from "../../domain/orchestrator/rules";
import * as backend from "../../infrastructure/backend";
import { isActive } from "../../infrastructure/window";
import { settings } from "../settings/settings";
import { useConversationsStore } from "../conversations/store";

// Closing a conversation, or leaving it idle for IDLE_MS after a turn: Claude reads it once more and writes what
// belongs in the vault straight in (lib.rs capture_vault). Nothing is shown or asked; the vault's git history is the
// review. Off with Settings › General.

/** User messages before a conversation is worth reading: a quick question has nothing for the vault. */
const MIN_TURNS = 3;
/** How long a conversation sits after its last turn before it is read: most are never closed. */
const IDLE_MS = 30 * 60_000;

// one at a time: closing all of a project's conversations must not start a Claude for each at once
let queue: Promise<unknown> = Promise.resolve();
// per conversation, its user messages when it was last read: nothing new since, nothing to read again
// ponytail: in memory, so after a restart a conversation already read is read once more; the prompt adds only what is missing
const readAt = new Map<string, number>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** Write what a conversation leaves for the vault, in the queue. Skipped for terminals, the coordinator, a
 *  conversation about mail (its text is not the user's), one shorter than MIN_TURNS user messages and one with no new
 *  user message since it was last read.
 *  ponytail: counts the messages loaded in the app; a conversation closed without ever being opened this run counts 0 */
function capture(key: string) {
  const { chats, messages } = useConversationsStore.getState();
  const chat = chats[key];
  if (settings().captureOnClose === false || isTerminal(key) || key === ORCH || !chat || chat.fromMail) return;
  const turns = (messages[key] ?? []).filter(message => message.kind === "me").length;
  if (turns < MIN_TURNS || turns <= (readAt.get(key) ?? 0)) return;
  readAt.set(key, turns);
  queue = queue.then(() => backend.captureVault(key).catch(error => console.error("capture", error)));
}

/** A conversation that just closed. */
export function captureOnClose(key: string) {
  clearTimeout(timers.get(key));
  timers.delete(key);
  capture(key);
}

/** Any agent event of a conversation: a turn end starts the idle clock, anything else stops it. Read when the clock
 *  runs out while it is idle and open, by the active Relay window only. */
export function captureWhenIdle(key: string, turnEnded: boolean) {
  clearTimeout(timers.get(key));
  timers.delete(key);
  if (!turnEnded) return;
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      const { chats, status } = useConversationsStore.getState();
      if (isActive() && !chats[key]?.closed && status[key] !== "busy") capture(key);
    }, IDLE_MS),
  );
}
