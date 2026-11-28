import { reposOf } from "../../domain/aikido/rules";
import type { Message } from "../../domain/settings/types";
import * as backend from "../../infrastructure/backend";
import { t, tn } from "../../shared/i18n";
import { useSettingsStore } from "./store";
import { commit } from "./window";

// Settings for Aikido: the region and the API client on its page in Integrations. Which code repos a vault project
// shows is not set anywhere: they are its GitHub repos that Aikido scans (application/aikido). The client ID and secret
// go to the keychain (vault-app.aikido) and never come back; the backend exchanges them for the token a call carries.

const current = () => useSettingsStore.getState().settings;
const get = (path: string) => backend.integrationCall("aikido", "GET", path, null);

/** Save the region and, when typed, the client; then one call to show they work together. */
export async function saveAikido(region: string, clientId: string, secret: string): Promise<Message> {
  try {
    if (clientId.trim()) await backend.integrationToken("aikido", clientId.trim(), "client_id");
    if (secret.trim()) await backend.integrationToken("aikido", secret.trim(), "client_secret");
    const hasToken = await backend.integrationHasToken("aikido");
    useSettingsStore.setState(draft => {
      draft.integrations.tokens.aikido = hasToken;
    });
    const next = { ...current(), integrations: { ...current().integrations, aikido: { on: true, region } } };
    commit(await backend.setSettings(next));
    if (!hasToken) return { text: t("ak.needBoth"), ok: false };
    const repos = reposOf(await get("/repositories/code?per_page=200"));
    return { text: tn("ak.connected", repos.length), ok: true };
  } catch (error) {
    return { text: String(error), ok: false };
  }
}
