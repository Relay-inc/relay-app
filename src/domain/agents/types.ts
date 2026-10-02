import type { AgentStatus } from "@relay/agent-core";

export type * from "@relay/agent-core";
/** What the backend knows about each provider: switched on, detected, capabilities, models and efforts. */
export type AgentsStatus = { default: string; providers: AgentStatus[] };
export type PickKind = "model" | "effort";
