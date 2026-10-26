import * as backend from "../../infrastructure/backend";
import { useSettingsStore } from "./store";

// The vault's git backup on General: the remote, on or off, how often. The backend keeps it in the vault's
// .relay/config.json and runs the rounds itself (vaultsync.rs); a round's result comes in as an event.
const set = useSettingsStore.setState;

/** The setting and the last round, then every round as it ends. Once, when the window opens. */
export async function watchVaultSync() {
  try {
    const saved = await backend.vaultSync();
    set(draft => {
      draft.vaultSync.saved = saved;
    });
  } catch {
    // no vault yet: the section shows empty
  }
  backend.sharedSync().then(all =>
    set(draft => {
      draft.sharedSync = all;
    }),
  );
  void backend.onSharedSync(all =>
    set(draft => {
      draft.sharedSync = all;
    }),
  );
  void backend.onVaultSync(last =>
    set(draft => {
      if (draft.vaultSync.saved) draft.vaultSync.saved.last = last;
    }),
  );
}

/** Save the setting; when it is on, the backend runs a round right away. */
export async function saveVaultSync(remote: string, on: boolean, minutes: number) {
  try {
    const saved = await backend.setVaultSync(remote, on, minutes);
    set(draft => {
      draft.vaultSync = { saved, message: null };
    });
  } catch (error) {
    set(draft => {
      draft.vaultSync.message = { text: String(error), ok: false };
    });
  }
}
