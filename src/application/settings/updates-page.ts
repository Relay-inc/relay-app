import * as backend from "../../infrastructure/backend";
import { t } from "../../shared/i18n";
import { useSettingsStore } from "./store";

// Settings › Updates: Relay's own update (checked by the backend at start and daily, src-tauri/src/updater.rs) and the
// agent CLIs. The page reads the last check when the window opens and looks again when it first shows.
const set = useSettingsStore.setState;
type Page = ReturnType<typeof useSettingsStore.getState>["updatesPage"];
const page = (patch: Partial<Page>) =>
  set(draft => {
    Object.assign(draft.updatesPage, patch);
  });

/** The last check, kept current by every later one (the daily check too) and the download's progress. */
export async function watchUpdates() {
  page({ status: await backend.updatesStatus() });
  void backend.onUpdates(status => page({ status }));
  void backend.onUpdateProgress(progress => page({ progress }));
}
export async function checkUpdates() {
  page({ checking: true, message: null });
  try {
    page({ status: await backend.updatesCheck() });
  } finally {
    page({ checking: false });
  }
}
/** Download and install; Relay restarts when it worked, else the page says why. */
export async function installUpdate() {
  page({ progress: { done: 0, total: null }, message: null });
  try {
    await backend.updatesInstall();
  } catch (error) {
    page({ progress: null, message: { text: String(error), ok: false } });
  }
}

export async function checkAgentUpdates() {
  try {
    page({ agents: await backend.agentUpdates() });
  } catch (error) {
    page({ agents: [], message: { text: String(error), ok: false } });
  }
}
const agentMessage = (id: string, text: string, ok: boolean) =>
  set(draft => {
    draft.updatesPage.agentMessages[id] = { text, ok };
  });
/** Run the agent's update, then read the versions again. */
export async function updateAgent(id: string) {
  page({ updating: id });
  set(draft => {
    draft.updatesPage.agentMessages[id] = null;
  });
  try {
    await backend.agentUpdate(id);
    agentMessage(id, t("upd.agentDone"), true);
  } catch (error) {
    agentMessage(id, String(error), false);
  } finally {
    page({ updating: "" });
  }
  await checkAgentUpdates();
}
