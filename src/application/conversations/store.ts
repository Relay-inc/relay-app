import { initialConversations, type ConversationsState } from "../../domain/conversations/state";
import { followChats } from "../../domain/conversations/rules";
import type { Chat } from "../../domain/conversations/types";
import { storage } from "../../infrastructure/storage";
import { makeStore } from "../make-store";

export type { ConversationsState };

export const useConversationsStore = makeStore<ConversationsState>(() =>
  initialConversations({
    chats: storage.get<Record<string, Chat>>("chats", {}),
    hidden: storage.get<string[]>("hiddenAgents", []),
    forked: storage.get<string[]>("forkedTerms", []),
  }),
);
// another Relay window wrote them
storage.watch("chats", () => {
  const next = followChats(useConversationsStore.getState().chats, storage.get<Record<string, Chat>>("chats", {}));
  useConversationsStore.setState(draft => {
    draft.chats = next;
  });
});
storage.watch("hiddenAgents", () =>
  useConversationsStore.setState(draft => {
    draft.hidden = storage.get<string[]>("hiddenAgents", []);
  }),
);
storage.watch("forkedTerms", () =>
  useConversationsStore.setState(draft => {
    draft.forked = storage.get<string[]>("forkedTerms", []);
  }),
);
