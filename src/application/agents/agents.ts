import type { AgentEvent, PickKind } from "../../domain/agents/types";
import { inheritedOf, knownCaps, knownTextOnly, picksOf, pickKey, seeDefaults } from "../../domain/agents/rules";
import { isTerminal } from "../../domain/navigation/keys";
import * as backend from "../../infrastructure/backend";
import { storage } from "../../infrastructure/storage";
import { useConversationsStore } from "../conversations/store";
import { useNavigationStore } from "../navigation/store";
import { loadCommands } from "../conversations/commands";
import { seenKey, useAgentsStore } from "./store";

// The agent providers as the backend reports them, and the composer's agent, model and effort for the open conversation.
const as = () => useAgentsStore.getState();

/** Detection runs each CLI once: not awaited at the start. */
export const loadAgents = () =>
  backend
    .agentsStatus()
    .then(status =>
      useAgentsStore.setState(draft => {
        draft.status = status;
        draft.loaded = true;
      }),
    )
    .then(loadCommands)
    .catch(e => console.error(e));
export const onAgents = () => as().status.providers.filter(x => x.on);
export const agentOf = (id: string) => as().status.providers.find(x => x.id === id);
/** A conversation's agent: its own, else the default; terminal sessions are Claude Code's. */
export const chatAgent = (chatKey: string) =>
  isTerminal(chatKey)
    ? "claude"
    : useConversationsStore.getState().chats[chatKey]?.provider || as().status.default || "claude";
/** What a conversation's agent can do; before the providers are known, what the built-in ones are known for. */
export const chatCaps = (chatKey: string) => agentOf(chatAgent(chatKey))?.caps ?? knownCaps(chatAgent(chatKey));
/** The slash commands of a conversation's agent that take no attachments. */
export const chatTextOnly = (chatKey: string) =>
  agentOf(chatAgent(chatKey))?.textOnly ?? knownTextOnly(chatAgent(chatKey));
/** The providers whose limits and tokens the usage view lists; Claude's alone until they are known. */
export const usageAgents = () =>
  as().loaded ? onAgents().map(x => ({ id: x.id, limits: x.caps.limits })) : [{ id: "claude", limits: true }];
/** The model or effort choices of a conversation's agent and the one picked (a stale pick reads as the default); the
 *  composer's is the open conversation. */
export function picks(kind: PickKind, chatKey = useNavigationStore.getState().selected) {
  const id = chatAgent(chatKey);
  return picksOf(as().status, id, kind, as().picked[pickKey(kind, id)] ?? "");
}
/** A `resolved` event: what the CLI runs on when the conversation left it the choice. */
export function sawDefaults(id: string, e: Extract<AgentEvent, { type: "resolved" }>) {
  const seen = seeDefaults(as().seen[id] ?? {}, e);
  storage.set(seenKey(id), seen);
  useAgentsStore.setState(draft => {
    draft.seen[id] = seen;
  });
}
/** The label of the inherited choice, once a conversation has shown it. */
export function inherited(kind: PickKind, chatKey = useNavigationStore.getState().selected) {
  const model = picks("model", chatKey).value;
  return inheritedOf(as().seen[chatAgent(chatKey)] ?? {}, kind, { model, list: picks(kind, chatKey).list });
}
export function setPick(kind: PickKind, value: string) {
  const { key } = picks(kind);
  storage.set(key, value);
  useAgentsStore.setState(draft => {
    draft.picked[key] = value;
  });
}
