import type { AgentStatus } from "@relay/agent-core";

export type * from "@relay/agent-core";
/** What the backend knows about each provider: switched on, detected, capabilities, models and efforts. */
export type AgentsStatus = { default: string; providers: AgentStatus[] };
/** One skill of Settings › Skills: `source` is where it comes from ("user", "project", "plugin", …), `state` whether it is on. */
export type Skill = { name: string; description: string; source: string; state: string };
export type PickKind = "model" | "effort";
/** What a fresh conversation without picks ran on, per provider (src-tauri read_agent); the effort per model. */
export type Seen = { model?: string; effort?: Record<string, string> };
