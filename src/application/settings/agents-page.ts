import type { Settings } from "../../domain/settings/types";
import { addAccount, type Accounts } from "../../domain/settings/accounts";
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
/** Claude's skills in this vault (Settings › Agents › Skills); `null` while they are asked, a fresh process reads them from disk. */
export async function loadSkills() {
  page({ skills: null });
  try {
    page({ skills: await backend.agentSkills("claude") });
  } catch (error) {
    page({ skills: [], message: { text: String(error), ok: false } });
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
/** An agent's logins, saved as a whole (Settings › Agents › Accounts). */
export const saveAgentAccounts = (id: string, accounts: Accounts) => saveAgent(id, accounts);
/** A folder picked as a new account; cancelled or already listed adds nothing. */
export async function addAgentAccount(id: string, now: Accounts) {
  const next = addAccount(now, (await backend.pickFolder()) ?? "");
  if (next) await saveAgentAccounts(id, next);
}
export const setDefaultAgent = (id: string) =>
  saveAgents(agents => {
    agents.default = id;
  });
export const clearAgentsMessage = () => page({ message: null });
/** What is left of each extra account's plan, in percent, by config folder: the worst of its windows. An account the
 *  provider says nothing about is left out. */
export async function accountRoom(id: string) {
  const room: Record<string, number> = {};
  const found = (await backend.usageLimits().catch(() => [])).find(p => p.provider === id);
  for (const account of found?.accounts ?? [])
    if (account.limits.ok && account.limits.windows.length)
      room[account.dir] = Math.max(0, Math.round(100 - Math.max(...account.limits.windows.map(w => w.pct))));
  return room;
}
