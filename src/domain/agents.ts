import { invoke } from "@tauri-apps/api/core";
import type { AgentProvider, AgentStatus } from "@relay/agent-core";
import claude from "@relay/agent-claude";
import codex from "@relay/agent-codex";
import opencode from "@relay/agent-opencode";
import { changed, ls } from "../core/store";
import { ui, isTerm } from "./ui";
import { chat } from "./chats/state";

export type * from "@relay/agent-core";

/** Every agent provider (packages/agent-*), in the order of the settings and the composer. A new one is one line
 * here and one in src-tauri/src/agents.rs. */
export const AGENTS: AgentProvider[] = [claude, codex, opencode];
export const agent = (id: string | undefined) => AGENTS.find(p => p.id === id);

/** What the backend knows about each provider: switched on, detected, capabilities, models and efforts. */
export type AgentsStatus = { default: string; providers: AgentStatus[] };
export const agentsStatus = () => invoke<AgentsStatus>("agents_status");

// ---------- what the backend reports, and the composer's agent, model and effort picks for the open conversation

export const agents = { status: { default: "claude", providers: [] } as AgentsStatus, loaded: false };
/** Detection runs each CLI once: not awaited at the start. */
export const loadAgents = () => agentsStatus().then(a => { agents.status = a; agents.loaded = true; changed(); }).catch(e => console.error(e));
export const onAgents = () => agents.status.providers.filter(p => p.on);
export const agentOf = (id: string) => agents.status.providers.find(p => p.id === id);
export const chatAgent = (k: string) => isTerm(k) ? "claude" : chat.chats[k]?.provider || agents.status.default || "claude";
/** The providers whose limits and tokens the usage view lists; Claude's alone until they are known. */
export const usageAgents = () => agents.loaded ? onAgents().map(p => ({ id: p.id, limits: p.caps.limits })) : [{ id: "claude", limits: true }];
// the last pick per provider; Claude's under the keys from before the providers
export const pickKey = (kind: "model" | "effort", id: string) => id === "claude" ? kind : `${kind}.${id}`;
// before the providers have answered, the composer offers Claude's models as it always did
const FALLBACK: Record<"model" | "effort", { id: string; label: string }[]> = {
  model: [["fable", "Fable"], ["opus", "Opus"], ["sonnet", "Sonnet"], ["haiku", "Haiku"]].map(([id, label]) => ({ id, label })),
  effort: [["low", "Low"], ["medium", "Medium"], ["high", "High"], ["xhigh", "Extra high"], ["max", "Max"]].map(([id, label]) => ({ id, label })),
};
/** The model or effort choices of the open conversation's agent, and the one picked (a stale pick reads as the default). */
export function picks(kind: "model" | "effort") {
  const id = chatAgent(ui.sel), st = agentOf(id);
  const list = st ? (kind === "model" ? st.models : st.efforts) : FALLBACK[kind], want = ls.get(pickKey(kind, id), "");
  return { list, value: list.some(c => c.id === want) ? want : "", key: pickKey(kind, id) };
}
export function setPick(kind: "model" | "effort", v: string) { ls.set(picks(kind).key, v); changed(); }
