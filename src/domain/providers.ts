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
export const provider = (id: string) => PROVIDERS.find(x => x.id === id);

/** The call context for a provider, from the settings as they are now. */
export const ctxOf = (
  boardProvider: BoardProvider,
  integrations: Record<string, IntegrationConfig> | undefined,
): Ctx => ({
  config: integrations?.[boardProvider.id] ?? {},
  call: (method, path, body) =>
    invoke<unknown>("integration_call", { provider: boardProvider.id, method, path, body: body ?? null }),
  upload: async (url, fields, file) => {
    if (file.size > 50e6) throw new Error(`${file.name}: > 50 MB`);
    const data = await new Promise<string>((ok, no) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result).split(",")[1] || "");
      r.onerror = () => no(r.error);
      r.readAsDataURL(file);
    });
    return invoke<string>("integration_upload", {
      provider: boardProvider.id,
      url,
      fields,
      name: file.name,
      mime: file.type || "application/octet-stream",
      data,
    });
  },
  thumb: url => invoke<string>("integration_thumb", { provider: boardProvider.id, url }),
});
/** Switched on, config complete and a token in the keychain: the board shows in the sidebar. */
export const ready = (boardProvider: BoardProvider) =>
  invoke<boolean>("integration_status", { provider: boardProvider.id }).catch(() => false);
