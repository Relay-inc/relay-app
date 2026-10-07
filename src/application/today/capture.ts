import { t } from "../../shared/i18n";
import { MIN_TURNS, applyPrompt } from "../../domain/today/capture";
import { WAIT } from "../../domain/navigation/views";
import { isTerminal } from "../../domain/navigation/keys";
import { ORCH } from "../../domain/orchestrator/rules";
import * as backend from "../../infrastructure/backend";
import { hideToast, select, toast } from "../navigation/navigation";
import { settings } from "../settings/settings";
import { useConversationsStore } from "../conversations/store";
import { label } from "../conversations/selectors";
import { startChat } from "../conversations/chats";
import { sendMsg } from "../conversations/actions";
import { setCapture, useTodayStore } from "./store";

// Closing a conversation: Claude reads it once more for what belongs in the vault and proposes it (nothing is
// written). The proposals land on Today with a toast to review them; Apply starts a conversation that makes the
// changes, where the user sees and allows each edit. Off with Settings › General › Propose vault updates.

// one at a time: closing all of a project's conversations must not start a Claude for each at once
let queue: Promise<unknown> = Promise.resolve();

/** Read a conversation that just closed for proposals, in the queue. Skipped for terminals, the coordinator, a
 *  conversation about mail (its text is not the user's) and one shorter than MIN_TURNS user messages.
 *  ponytail: counts the messages loaded in the app; a conversation closed without ever being opened this run counts 0 */
export function captureOnClose(key: string) {
  const { chats, messages } = useConversationsStore.getState();
  const chat = chats[key];
  if (settings().captureOnClose === false || isTerminal(key) || key === ORCH || !chat || chat.fromMail) return;
  if ((messages[key] ?? []).filter(message => message.kind === "me").length < MIN_TURNS) return;
  const title = label(key);
  queue = queue.then(async () => {
    const proposals = await backend.captureProposals(key).catch(error => {
      console.error("capture", error);
      return [];
    });
    if (!proposals.length) return;
    setCapture(key, { key, title, project: chat.project ?? null, at: Date.now(), proposals });
    toast(t("capture.toast", { n: proposals.length, title }), () => openCapture(key), t("capture.review"), 12000);
  });
}

/** Today with the conversation's proposals open. */
export async function openCapture(key: string) {
  hideToast();
  await select(WAIT);
  useTodayStore.setState(draft => {
    draft.selected = `capture:${key}`;
  });
}

/** Leave one proposal out; the last one gone takes the item off Today. */
export function dropProposal(key: string, index: number) {
  const capture = useTodayStore.getState().captures[key];
  if (!capture) return;
  const proposals = capture.proposals.filter((_, i) => i !== index);
  setCapture(key, proposals.length ? { ...capture, proposals } : null);
}

/** Skip: none of it goes in the vault. */
export const skipCapture = (key: string) => setCapture(key, null);

/** Apply: a conversation under the same project that makes the changes, its edits allowed or denied by the user. */
export async function applyCapture(key: string) {
  const capture = useTodayStore.getState().captures[key];
  if (!capture) return;
  const chat = startChat(capture.project, {
    provider: "claude",
    title: t("capture.chatTitle", { title: capture.title }).slice(0, 48),
    note: t("capture.chatNote", { title: capture.title }),
  });
  setCapture(key, null);
  await select(chat);
  sendMsg(applyPrompt(capture.proposals));
}
