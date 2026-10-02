import type { BoardProvider } from "@relay/board-core";
import type { AgentProvider } from "@relay/agent-core";
import productive from "@relay/integration-productive";
import trello from "@relay/integration-trello";
import linear from "@relay/integration-linear";
import claude from "@relay/agent-claude";
import codex from "@relay/agent-codex";
import opencode from "@relay/agent-opencode";

/** Every integration (packages/integration-*), in the order of the sidebar and the settings list. A new one is
 * one line here and one in src-tauri/src/providers.rs. */
export const PROVIDERS: BoardProvider[] = [productive, trello, linear];
export const provider = (id: string) => PROVIDERS.find(x => x.id === id);

/** Every agent provider (packages/agent-*), in the order of the settings and the composer. A new one is one line
 * here and one in src-tauri/src/agents.rs. */
export const AGENTS: AgentProvider[] = [claude, codex, opencode];
export const agent = (id: string | undefined) => AGENTS.find(x => x.id === id);
