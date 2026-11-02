import { projectsOf, refOf, workspacesOf } from "../../domain/buddy/rules";
import type { Message } from "../../domain/settings/types";
import * as backend from "../../infrastructure/backend";
import { t } from "../../shared/i18n";
import { useSettingsStore } from "./store";
import { commit, save } from "./window";

// Settings for Buddy: the region and the token on its page in Integrations, the Buddy project per vault project in
// Settings › Projects. The token goes to the keychain (vault-app.buddy/token) and never comes back.

const current = () => useSettingsStore.getState().settings;
const get = (path: string) => backend.integrationCall("buddy", "GET", path, null);

/** Save the region and, when typed, the token; then one call to show they work together. */
export async function saveBuddy(host: string, token: string): Promise<Message> {
  try {
    if (token.trim()) await backend.integrationToken("buddy", token.trim());
    const hasToken = await backend.integrationHasToken("buddy");
    useSettingsStore.setState(draft => {
      draft.integrations.tokens.buddy = hasToken;
    });
    const next = { ...current(), integrations: { ...current().integrations, buddy: { on: true, host } } };
    commit(await backend.setSettings(next));
    const workspaces = workspacesOf(await get("/workspaces"));
    return { text: t("bd.connected", { list: workspaces.join(", ") || "–" }), ok: true };
  } catch (error) {
    return { text: String(error), ok: false };
  }
}
/** Every project in every workspace the token can read, as "workspace/project" options. */
export async function buddyProjects() {
  const workspaces = workspacesOf(await get("/workspaces"));
  const lists = await Promise.all(
    workspaces.map(async w => projectsOf(w, await get(`/workspaces/${encodeURIComponent(w)}/projects?per_page=100`))),
  );
  return lists.flat().sort((a, b) => a.name.localeCompare(b.name));
}
/** Link a vault project to a Buddy project ("workspace/project"), or unlink it (""). */
export function linkBuddy(project: string, value: string) {
  const buddy = { ...current().buddy };
  const ref = refOf(value);
  if (ref) buddy[project] = ref;
  else delete buddy[project];
  return save({ ...current(), buddy });
}
