import type { BoardProvider, Ctx } from "../../domain/board/types";
import type { IntegrationConfig } from "../../domain/settings/types";
import * as backend from "../../infrastructure/backend";
import { settings } from "../settings/settings";
import { readUrl } from "../../infrastructure/images";

/** The call context for a provider, from the given settings or the settings as they are now. */
export const ctxOf = (
  boardProvider: BoardProvider,
  integrations: Record<string, IntegrationConfig> | undefined = settings().integrations,
): Ctx => ({
  config: integrations?.[boardProvider.id] ?? {},
  call: (method, path, body) => backend.integrationCall(boardProvider.id, method, path, body ?? null),
  upload: async (url, fields, file) => {
    if (file.size > 50e6) throw new Error(`${file.name}: > 50 MB`);
    const data = String(await readUrl(file)).split(",")[1] || "";
    return backend.integrationUpload({
      provider: boardProvider.id,
      url,
      fields,
      name: file.name,
      mime: file.type || "application/octet-stream",
      data,
    });
  },
  thumb: url => backend.integrationThumb(boardProvider.id, url),
});
/** Switched on, config complete and a token in the keychain: the board shows in the sidebar. */
export const providerReady = (boardProvider: BoardProvider) =>
  backend.integrationStatus(boardProvider.id).catch(() => false);
