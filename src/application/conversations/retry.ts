import { t } from "../../shared/i18n";
import type { Retry, RetryEvent } from "../../domain/conversations/types";
import * as backend from "../../infrastructure/backend";
import { useConversationsStore } from "./store";
import { ensureHistory } from "./history";
import { notify } from "./events";
import { sendMsg } from "./actions";

// Auto-retry after a provider limit (src-tauri/src/retry.rs): the backend keeps the waiting conversations and says
// when one is due, the page sends it like a message typed there, with the conversation's own model and machine.

const RESUME = "The usage limit has reset. Continue where you left off.";

function adopt(retries: Retry[]) {
  useConversationsStore.setState(draft => {
    draft.retries = Object.fromEntries(retries.map(retry => [retry.key, retry]));
  });
}
export const loadRetries = async () => adopt((await backend.retries().catch(() => null)) ?? []);
export const cancelRetry = (key: string) => backend.retryCancel(key);

/** The backend's `retry` event. A refused turn that did nothing yet sends its message again, else the agent goes on. */
export async function onRetryEvent(event: RetryEvent) {
  if (event.type === "list") return adopt(event.retries);
  const { key } = event;
  if (!useConversationsStore.getState().chats[key]) return; // closed meanwhile
  if (!useConversationsStore.getState().messages[key]) await ensureHistory(key).catch(() => {});
  const mine = (useConversationsStore.getState().messages[key] || []).filter(item => item.kind === "me").pop()?.text;
  notify(key, t("retry.started"));
  await sendMsg(event.fresh && mine ? mine : RESUME, key);
}
