import type { AgentsStatus, Seen, ServerStatus } from "../../domain/agents/types";
import { pickKey } from "../../domain/agents/rules";
import { AGENTS } from "../../shared/plugins";
import { storage } from "../../infrastructure/storage";
import { makeStore } from "../make-store";

/** What the backend reports about the agent providers, the composer's last model and effort pick per provider, and the
 *  CLI defaults each provider was seen running on. */
type AgentsState = {
  status: AgentsStatus;
  loaded: boolean;
  picked: Record<string, string>; // by pick key (`model`, `effort.codex`, …), as stored
  seen: Record<string, Seen>; // by provider, stored as `defaults.<id>`
  server: ServerStatus; // where a conversation can run besides here
};

export const seenKey = (id: string) => `defaults.${id}`;

export const useAgentsStore = makeStore<AgentsState>(() => ({
  status: { default: "claude", providers: [] },
  loaded: false,
  picked: Object.fromEntries(
    AGENTS.flatMap(agent =>
      (["model", "effort"] as const).map(kind => [pickKey(kind, agent.id), storage.get(pickKey(kind, agent.id), "")]),
    ),
  ),
  seen: Object.fromEntries(AGENTS.map(agent => [agent.id, storage.get<Seen>(seenKey(agent.id), {})])),
  server: { configured: false, online: false },
}));
