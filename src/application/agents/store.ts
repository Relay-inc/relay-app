import type { AgentsStatus } from "../../domain/agents/types";
import { pickKey } from "../../domain/agents/rules";
import { AGENTS } from "../../shared/plugins";
import { storage } from "../../infrastructure/storage";
import { makeStore } from "../make-store";

/** What the backend reports about the agent providers, and the composer's last model and effort pick per provider. */
type AgentsState = {
  status: AgentsStatus;
  loaded: boolean;
  picked: Record<string, string>; // by pick key (`model`, `effort.codex`, …), as stored
};

export const useAgentsStore = makeStore<AgentsState>(() => ({
  status: { default: "claude", providers: [] },
  loaded: false,
  picked: Object.fromEntries(
    AGENTS.flatMap(agent =>
      (["model", "effort"] as const).map(kind => [pickKey(kind, agent.id), storage.get(pickKey(kind, agent.id), "")]),
    ),
  ),
}));
