import { initialConversations, type ConversationsState } from "../../domain/conversations/state";
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
