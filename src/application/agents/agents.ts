import type { PickKind } from "../../domain/agents/types";
import { picksOf, pickKey } from "../../domain/agents/rules";
import { isTerminal } from "../../domain/navigation/keys";
import * as backend from "../../infrastructure/backend";
import { storage } from "../../infrastructure/storage";
import { useConversationsStore } from "../conversations/store";
import { useNavigationStore } from "../navigation/store";
import { useAgentsStore } from "./store";

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
    .catch(e => console.error(e));
export const onAgents = () => as().status.providers.filter(x => x.on);
export const agentOf = (id: string) => as().status.providers.find(x => x.id === id);
/** A conversation's agent: its own, else the default; terminal sessions are Claude Code's. */
export const chatAgent = (chatKey: string) =>
  isTerminal(chatKey)
    ? "claude"
    : useConversationsStore.getState().chats[chatKey]?.provider || as().status.default || "claude";
/** The providers whose limits and tokens the usage view lists; Claude's alone until they are known. */
export const usageAgents = () =>
  as().loaded ? onAgents().map(x => ({ id: x.id, limits: x.caps.limits })) : [{ id: "claude", limits: true }];
/** The model or effort choices of the open conversation's agent, and the one picked (a stale pick reads as the default). */
export function picks(kind: PickKind) {
  const id = chatAgent(useNavigationStore.getState().selected);
  return picksOf(as().status, id, kind, as().picked[pickKey(kind, id)] ?? "");
}
export function setPick(kind: PickKind, value: string) {
  const { key } = picks(kind);
  storage.set(key, value);
  useAgentsStore.setState(draft => {
    draft.picked[key] = value;
  });
}
