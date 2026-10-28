import type { Chat } from "./types";

/** Where a project's conversations sit once the project moved to another workspace under `key`: a draft and every
 *  conversation the backend moved along (`moved`, its transcript went too) under `key`; one that stayed (another agent,
 *  or mail into a team workspace) becomes a general conversation of the workspace it ran in (`ranIn`, none for the
 *  main one). The keys that stayed, for their note. */
export function rehome(
  chats: Record<string, Chat>,
  project: string,
  key: string,
  moved: Set<string>,
  started: (chat: string) => boolean,
  ranIn?: string,
): string[] {
  const stayed: string[] = [];
  for (const chat of Object.values(chats)) {
    if (chat.project !== project) continue;
    if (!started(chat.key) || moved.has(chat.key)) {
      chat.project = key;
      delete chat.vault;
      continue;
    }
    chat.project = null;
    delete chat.folder;
    if (ranIn) chat.vault = ranIn;
    stayed.push(chat.key);
  }
  return stayed;
}
