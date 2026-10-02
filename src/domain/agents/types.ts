import type { AgentStatus } from "@relay/agent-core";

export type * from "@relay/agent-core";
/** What the backend knows about each provider: switched on, detected, capabilities, models and efforts. */
export type AgentsStatus = { default: string; providers: AgentStatus[] };
export type PickKind = "model" | "effort";
/** What a fresh conversation without picks ran on, per provider (src-tauri read_agent); the effort per model. */
export type Seen = { model?: string; effort?: Record<string, string> };
