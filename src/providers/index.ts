import { invoke } from "@tauri-apps/api/core";
import type { BoardProvider, Ctx } from "./types";
import productive from "./productive";

export type * from "./types";

/** Every board provider, in the order of the sidebar and the settings list. A new one is added here and in providers.rs. */
export const PROVIDERS: BoardProvider[] = [productive];
export const provider = (id: string) => PROVIDERS.find(p => p.id === id);

/** The call context for a provider, from the settings as they are now. */
export const ctxOf = (p: BoardProvider, integrations: Record<string, any> | undefined): Ctx => ({
  config: integrations?.[p.id] ?? {},
  call: (method, path, body) => invoke<any>("integration_call", { provider: p.id, method, path, body: body ?? null }),
});
/** Switched on, config complete and a token in the keychain: the board shows in the sidebar. */
export const ready = (p: BoardProvider) => invoke<boolean>("integration_status", { provider: p.id }).catch(() => false);
