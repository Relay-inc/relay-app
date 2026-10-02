import type { AgentStatus } from "@relay/agent-core";

export type * from "@relay/agent-core";
/** What the backend knows about each provider: switched on, detected, capabilities, models and efforts. */
export type AgentsStatus = { default: string; providers: AgentStatus[] };
/** The server's last status (src-tauri/src/server.rs): set up, answering, and what it said or failed with. */
export type ServerStatus = { configured: boolean; online: boolean; version?: string; vault?: string; error?: string };
export type PickKind = "model" | "effort";
/** What a fresh conversation without picks ran on, per provider (src-tauri read_agent); the effort per model. */
export type Seen = { model?: string; effort?: Record<string, string> };
