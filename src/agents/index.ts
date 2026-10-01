import { invoke } from "@tauri-apps/api/core";
import type { AgentProvider, AgentStatus } from "@relay/agent-core";
import claude from "@relay/agent-claude";
import codex from "@relay/agent-codex";
import opencode from "@relay/agent-opencode";

export type * from "@relay/agent-core";

/** Every agent provider (packages/agent-*), in the order of the settings and the composer. A new one is one line
 * here and one in src-tauri/src/agents.rs. */
export const AGENTS: AgentProvider[] = [claude, codex, opencode];
export const agent = (id: string | undefined) => AGENTS.find(p => p.id === id);

/** What the backend knows about each provider: switched on, detected, capabilities, models and efforts. */
export type AgentsStatus = { default: string; providers: AgentStatus[] };
export const agentsStatus = () => invoke<AgentsStatus>("agents_status");
