import { invoke } from "@tauri-apps/api/core";
import type { AgentProvider, AgentStatus } from "@relay/agent-core";
import claude from "@relay/agent-claude";
import codex from "@relay/agent-codex";
import opencode from "@relay/agent-opencode";
import { changed, ls } from "../core/store";
import { ui, isTerminal } from "./ui";
import { chat } from "./chats/state";
import type { SlashCommand } from "./commands";

export type * from "@relay/agent-core";

/** Every agent provider (packages/agent-*), in the order of the settings and the composer. A new one is one line
 * here and one in src-tauri/src/agents.rs. */
export const AGENTS: AgentProvider[] = [claude, codex, opencode];
export const agent = (id: string | undefined) => AGENTS.find(x => x.id === id);

/** What the backend knows about each provider: switched on, detected, capabilities, models and efforts. */
export type AgentsStatus = { default: string; providers: AgentStatus[] };
export const agentsStatus = () => invoke<AgentsStatus>("agents_status");

// ---------- what the backend reports, and the composer's agent, model and effort picks for the open conversation

export const agents = { status: { default: "claude", providers: [] } as AgentsStatus, loaded: false };
/** Detection runs each CLI once: not awaited at the start. */
export const loadAgents = () =>
  agentsStatus()
    .then(status => {
      agents.status = status;
      agents.loaded = true;
      changed();
    })
    .catch(e => console.error(e));
export const onAgents = () => agents.status.providers.filter(x => x.on);
export const agentOf = (id: string) => agents.status.providers.find(x => x.id === id);
export const chatAgent = (chatKey: string) =>
  isTerminal(chatKey) ? "claude" : chat.chats[chatKey]?.provider || agents.status.default || "claude";
/** The providers whose limits and tokens the usage view lists; Claude's alone until they are known. */
export const usageAgents = () =>
  agents.loaded ? onAgents().map(x => ({ id: x.id, limits: x.caps.limits })) : [{ id: "claude", limits: true }];
// the last pick per provider; Claude's under the keys from before the providers
export const pickKey = (kind: "model" | "effort", id: string) => (id === "claude" ? kind : `${kind}.${id}`);
// before the providers have answered, the composer offers Claude's models as it always did
const FALLBACK: Record<"model" | "effort", { id: string; label: string }[]> = {
  model: [
    ["fable", "Fable"],
    ["opus", "Opus"],
    ["sonnet", "Sonnet"],
    ["haiku", "Haiku"],
  ].map(([id, label]) => ({ id, label })),
  effort: [
    ["low", "Low"],
    ["medium", "Medium"],
    ["high", "High"],
    ["xhigh", "Extra high"],
    ["max", "Max"],
  ].map(([id, label]) => ({ id, label })),
};
/** The model or effort choices of the open conversation's agent, and the one picked (a stale pick reads as the default). */
export function picks(kind: "model" | "effort") {
  const id = chatAgent(ui.selected);
  const status = agentOf(id);
  const own = kind === "model" ? status?.models : status?.efforts;
  const list = status ? own! : FALLBACK[kind];
  const wanted = ls.get(pickKey(kind, id), "");
  return { list, value: list.some(choice => choice.id === wanted) ? wanted : "", key: pickKey(kind, id) };
}
export function setPick(kind: "model" | "effort", value: string) {
  ls.set(picks(kind).key, value);
  changed();
}

// ---------- Claude Code's slash commands and skills, from its last start: kept, so the composer completes before one runs
export const commands = { list: ls.get<SlashCommand[]>("commands", []) };
export function setCommands(list: SlashCommand[]) {
  commands.list = list.map(({ name, description, argumentHint }) => ({ name, description, argumentHint }));
  ls.set("commands", commands.list);
}
