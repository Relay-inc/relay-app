import { grew, relatedQuery } from "../../domain/related/rules";
import * as backend from "../../infrastructure/backend";
import { useConversationsStore } from "../conversations/store";
import { useRelatedStore } from "./store";

/** Ask the vault's index for the notes a conversation is about, again when it has new messages. */
export async function loadRelated(key: string) {
  const items = useConversationsStore.getState().messages[key] ?? [];
  if (!grew(items.length, useRelatedStore.getState().asked[key])) return;
  useRelatedStore.setState(draft => {
    draft.asked[key] = items.length;
  });
  const hits = await backend.relatedNotes(relatedQuery(items)).catch(err => {
    console.error(err);
    return [];
  });
  useRelatedStore.setState(draft => {
    draft.hits[key] = hits;
  });
}
