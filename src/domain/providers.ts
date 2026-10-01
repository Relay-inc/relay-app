import { invoke } from "@tauri-apps/api/core";
import type { BoardProvider, Ctx } from "@relay/board-core";
import productive from "@relay/integration-productive";
import trello from "@relay/integration-trello";
import linear from "@relay/integration-linear";
import type { IntegrationConfig } from "./config";

export type * from "@relay/board-core";

/** Every integration (packages/integration-*), in the order of the sidebar and the settings list. A new one is
 * one line here and one in src-tauri/src/providers.rs. */
export const PROVIDERS: BoardProvider[] = [productive, trello, linear];
export const provider = (id: string) => PROVIDERS.find(p => p.id === id);

/** The call context for a provider, from the settings as they are now. */
export const ctxOf = (p: BoardProvider, integrations: Record<string, IntegrationConfig> | undefined): Ctx => ({
  config: integrations?.[p.id] ?? {},
  call: (method, path, body) =>
    invoke<unknown>("integration_call", { provider: p.id, method, path, body: body ?? null }),
});
/** Switched on, config complete and a token in the keychain: the board shows in the sidebar. */
export const ready = (p: BoardProvider) => invoke<boolean>("integration_status", { provider: p.id }).catch(() => false);
