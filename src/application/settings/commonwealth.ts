import * as backend from "../../infrastructure/backend";
import { useCommonwealthStore } from "./commonwealth-store";

// Commonwealth in Settings › Integrations: its status, installing its plugin, joining a team brain.
const set = useCommonwealthStore.setState;

/** The plugin's state and the CLI, for Settings. */
export async function loadCommonwealthStatus() {
  try {
    const status = await backend.commonwealthStatus();
    set(draft => {
      draft.status = status;
    });
  } catch (e) {
    set(draft => {
      draft.installErr = String(e);
    });
  }
}
export async function installCommonwealth() {
  set(draft => {
    draft.installing = true;
    draft.installErr = "";
  });
  try {
    await backend.commonwealthInstall();
  } catch (e) {
    set(draft => {
      draft.installErr = String(e);
    });
  }
  set(draft => {
    draft.installing = false;
  });
  await loadCommonwealthStatus();
}
/** Clone a team brain and route its projects' orgs to it, then reload which project uses which brain. */
export async function joinTeamBrain(remote: string) {
  set(draft => {
    draft.joining = true;
    draft.joined = "";
    draft.joinErr = "";
  });
  try {
    const out = await backend.commonwealthJoin(remote.trim());
    set(draft => {
      draft.joined = out;
    });
  } catch (e) {
    set(draft => {
      draft.joinErr = String(e);
    });
  }
  set(draft => {
    draft.joining = false;
  });
  await loadCommonwealthStatus();
}
