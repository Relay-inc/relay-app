import type { Settings } from "../../domain/settings/types";
import * as backend from "../../infrastructure/backend";
import { commit } from "./window";
import { useSettingsStore } from "./store";

// Settings › Agents: only the ones switched on are listed, the others are in the Add menu. Every change saves at once.
const set = useSettingsStore.setState;
const page = (patch: Partial<ReturnType<typeof useSettingsStore.getState>["agentsPage"]>) =>
  set(draft => {
    Object.assign(draft.agentsPage, patch);
  });

/** What the backend detects per provider (installed, version, login); `quiet` keeps the old answer shown meanwhile. */
export async function checkAgents(quiet = false) {
  if (!quiet) page({ detected: null });
  try {
    page({ detected: await backend.agentsStatus() });
  } catch (error) {
    page({ message: { text: String(error), ok: false } });
  }
}
type AgentsConfig = Settings["agents"];
/** One change to settings.agents, saved; the backend keeps the default on a switched-on agent. */
async function saveAgents(change: (agents: AgentsConfig) => void) {
  const settings = useSettingsStore.getState().settings;
  const agents = structuredClone(settings.agents);
  change(agents);
  try {
    commit(await backend.setSettings({ ...settings, agents }));
    page({ message: null });
  } catch (error) {
    page({ message: { text: String(error), ok: false } });
  }
}
export const saveAgent = (id: string, changes: Record<string, unknown>) =>
  saveAgents(agents => {
    agents.providers[id] = { ...agents.providers[id], ...changes };
  });
/** A new program path: saved, then detected again without hiding the list. */
export async function saveAgentBin(id: string, bin: string) {
  await saveAgent(id, { bin });
  checkAgents(true);
}
export const setDefaultAgent = (id: string) =>
  saveAgents(agents => {
    agents.default = id;
  });
export const clearAgentsMessage = () => page({ message: null });
