import * as backend from "../../infrastructure/backend";
import { cleanCommands } from "../../domain/conversations/commands";
import { useAgentsStore } from "../agents/store";
import { useConversationsStore } from "./store";

// The slash commands and skills per provider for the current vault, never a cache across vaults: asked whenever the
// agents are (loadAgents), and an agent's start updates its own list (the `commands` event).
let generation = 0;
export function loadCommands() {
  const mine = ++generation;
  useConversationsStore.setState(draft => {
    draft.commands = {};
  });
  return Promise.all(
    useAgentsStore
      .getState()
      .status.providers.filter(p => p.on && p.detect.installed)
      .map(async provider => {
        try {
          const list = cleanCommands(await backend.agentCommands(provider.id));
          // a late answer for another vault never lands
          if (mine === generation)
            useConversationsStore.setState(draft => {
              draft.commands[provider.id] = list;
            });
        } catch (e) {
          console.error(e);
        }
      }),
  );
}
