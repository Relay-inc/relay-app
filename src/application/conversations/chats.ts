import { newChatKey } from "../../domain/navigation/keys";
import { chatsToStore, newChatEntry } from "../../domain/conversations/rules";
import { ensureCoordinator, ensureWorkerChat } from "../../domain/orchestrator/rules";
import type { Worker } from "../../domain/orchestrator/types";
import { storage } from "../../infrastructure/storage";
import { useConversationsStore } from "./store";
import { typedOf, useDraftsStore } from "./drafts";

/** The conversations' metadata to localStorage (`chats`): a draft only once something is typed in it. */
export const saveChats = () =>
  storage.set(
    "chats",
    chatsToStore({ chats: useConversationsStore.getState().chats, typed: useDraftsStore.getState().typed }),
  );
/** A new draft conversation under a project (null: general); its key. It is stored once something is typed. */
export function newChat(project: string | null): string {
  const now = Date.now();
  const key = newChatKey(now);
  useConversationsStore.setState(draft => {
    draft.chats[key] = newChatEntry(key, project, now);
  });
  return key;
}
/** A new conversation that starts from something (a mail, a PR review): its title and a first note, which also keeps
 *  the title (no generated one). `fromMail` gives it the mail restrictions, `mail` goes in front of the first message
 *  the user sends, `provider` fixes its agent, `meeting` makes it that meeting's briefing. Its key. */
export function startChat(
  project: string | null,
  start: {
    title: string;
    note: string;
    fromMail?: boolean;
    mail?: string;
    provider?: string;
    meeting?: string;
    pr?: string;
  },
): string {
  const key = newChat(project);
  useConversationsStore.setState(draft => {
    const conversation = draft.chats[key];
    conversation.title = start.title;
    if (start.fromMail) conversation.fromMail = true;
    if (start.mail) conversation.mail = start.mail;
    if (start.provider) conversation.provider = start.provider;
    if (start.meeting) conversation.meeting = start.meeting;
    if (start.pr) conversation.pr = start.pr;
    draft.messages[key] = [{ kind: "note", text: start.note }];
  });
  return key;
}
/** A draft left behind with nothing in it (no messages, nothing typed) disappears; one with typed text stays. */
export function dropEmptyDraft(key: string) {
  const { chats, messages } = useConversationsStore.getState();
  if (chats[key]?.draft && !(messages[key] || []).length && !typedOf(key))
    useConversationsStore.setState(draft => {
      delete draft.chats[key];
    });
}
/** The conversation is open now: no longer unseen, and a route question of another one is dropped. */
export const markSeen = (key: string) =>
  useConversationsStore.setState(draft => {
    draft.unseen.delete(key);
    draft.routeChoice = draft.routeChoice?.key === key ? draft.routeChoice : null;
  });
/** The orchestrator's coordinator as a conversation: general, Claude's, never closed (application/orchestrator). */
export function ensureCoordinatorChat() {
  useConversationsStore.setState(draft => {
    ensureCoordinator(draft.chats);
  });
  saveChats();
}
/** A conversation under its project for each worker the app did not know yet. */
export function adoptWorkers(workers: Worker[]) {
  let changed = false;
  useConversationsStore.setState(draft => {
    for (const worker of workers) changed = ensureWorkerChat(draft.chats, worker) || changed;
  });
  if (changed) saveChats();
}
