import { matchRepos } from "../../domain/aikido/rules";
import { readRepos } from "../aikido/repos";
import type { Message } from "../../domain/settings/types";
import * as backend from "../../infrastructure/backend";
import { t, tn } from "../../shared/i18n";
import { useSettingsStore } from "./store";
import { commit } from "./window";

// Settings for Aikido: the region and the API client on its page in Integrations. Which code repos a vault project
// shows is not set anywhere: they are its GitHub repos that Aikido scans (application/aikido). The client ID and secret
// go to the keychain (vault-app.aikido) and never come back; the backend exchanges them for the token a call carries.

const current = () => useSettingsStore.getState().settings;
/** Save the region and, when typed, the client; then read the code repos to show they work together, and which
 *  projects' GitHub repos are among them. */
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
    const [repos, slugs] = await Promise.all([readRepos(), backend.projectRepos()]);
    // which projects get a Security tab, so a project without one can be told apart from a connection that fails
    const matched = Object.entries(slugs)
      .map(([project, list]) => [project, matchRepos(repos, list).length] as const)
      .filter(([, n]) => n > 0)
      .map(([project, n]) => `${project} (${n})`);
    const which = matched.length ? t("ak.matched", { list: matched.join(", ") }) : t("ak.matchedNone");
    return { text: `${tn("ak.connected", repos.length)}. ${which}`, ok: true };
  } catch (error) {
    return { text: String(error), ok: false };
  }
}
