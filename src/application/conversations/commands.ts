import type { SlashCommand } from "../../domain/conversations/commands";
import * as backend from "../../infrastructure/backend";
import { storage } from "../../infrastructure/storage";
import { useConversationsStore } from "./store";

// Claude Code's slash commands and skills, from its last start: kept (`commands`), so the composer completes before one runs.
export const saveCommands = () => storage.set("commands", useConversationsStore.getState().commands);
function setCommands(list: SlashCommand[]) {
  useConversationsStore.setState(draft => {
    draft.commands = list.map(({ name, description, argumentHint }) => ({ name, description, argumentHint }));
  });
  saveCommands();
}
/** Asked once at the start, without waiting for a conversation; a Claude start updates it too (events.ts). */
export const loadCommands = () =>
  backend
    .claudeCommands()
    .then(setCommands)
    .catch(e => console.error(e));
