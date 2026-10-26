import { t } from "../../shared/i18n";
import * as backend from "../../infrastructure/backend";
import { useSettingsStore, type SettingsState } from "./store";

// Settings › General › Shared vaults: vaults a team shares on a relay-server, each synced into a folder here
// (src-tauri/src/shared_vaults.rs). The backend keeps the list in the settings and runs the rounds; a round's result
// comes in as an event. Invites, members and leaving go to the server through the backend.
type Shared = SettingsState["shared"];
const st = () => useSettingsStore.getState().shared;
const change = (recipe: (draft: Shared) => void) => useSettingsStore.setState(draft => recipe(draft.shared));
const say = (key: string, text: string, ok = false) =>
  change(draft => {
    draft.messages[key] = text ? { text, ok } : null;
  });

/** Runs `work` as `busy`, its error shown under `key`. True when it worked. */
async function run(busy: string, key: string, work: () => Promise<unknown>) {
  change(draft => {
    draft.busy = busy;
    draft.messages[key] = null;
  });
  try {
    await work();
    return true;
  } catch (error) {
    say(key, String(error));
    return false;
  } finally {
    change(draft => {
      draft.busy = "";
    });
  }
}

/** The settings and the extra vaults read again: the backend changed the list of shared vaults itself. */
async function reload() {
  const [settings, extraVaults] = await Promise.all([backend.getSettings(), backend.extraVaultsStatus()]);
  useSettingsStore.setState(draft => {
    draft.settings = settings;
    draft.extraVaults = extraVaults;
  });
}

/** The join form opened with an invite link in it. */
function openJoin(link: string) {
  change(draft => {
    draft.form = { ...draft.form, mode: "join", link, recovery: "" };
    draft.messages.form = null;
  });
}

/** The rounds so far and then each one as it ends, and the invite link that opened Relay (now or later): the join
 *  form opens with it, on General (`show`). Once, when the window opens. */
export async function watchSharedVaults(show: () => void) {
  void backend.onSharedVaults(status => change(draft => void (draft.status = status)));
  void backend.onVaultInvite(link => {
    openJoin(link);
    show();
  });
  try {
    const status = await backend.sharedVaultsStatus();
    change(draft => void (draft.status = status));
    const link = await backend.sharedVaultPendingInvite();
    if (link) {
      openJoin(link);
      show();
    }
  } catch {
    // an older backend: no shared vaults
  }
}

/** The form under the list: "new", "join" or closed (""). */
export const openForm = (mode: Shared["form"]["mode"]) =>
  change(draft => {
    draft.form = { ...draft.form, mode, recovery: "" };
    draft.messages.form = null;
  });
export const editForm = (patch: Partial<Pick<Shared["form"], "machine" | "name" | "link">>) =>
  change(draft => void Object.assign(draft.form, patch));
export async function pickSharedFolder() {
  const folder = await backend.pickFolder();
  if (folder) change(draft => void (draft.form.folder = folder));
}

/** Make the vault on the machine; the form then shows its recovery key, once. */
export async function createSharedVault(machine: string) {
  const { name, folder } = st().form;
  let recovery = "";
  const made = await run("create", "form", async () => {
    recovery = (await backend.sharedVaultCreate(machine, name, folder)).recovery;
    await reload();
  });
  if (made)
    change(draft => {
      draft.form = { mode: "new", machine: "", name: "", folder: "", link: "", recovery };
    });
}
export async function joinSharedVault() {
  const { link, folder } = st().form;
  const joined = await run("join", "form", async () => {
    await backend.sharedVaultJoin(link.trim(), folder);
    await reload();
  });
  if (joined)
    change(draft => {
      draft.form = { mode: "", machine: "", name: "", folder: "", link: "", recovery: "" };
    });
}

/** The members and open invites read again, when they show. */
async function loadInfo(id: string) {
  const info = await backend.sharedVaultInfo(id);
  change(draft => {
    if (id in draft.info) draft.info[id] = info;
  });
}
/** The members shown or folded away. */
export async function toggleMembers(id: string) {
  if (id in st().info) {
    change(draft => void delete draft.info[id]);
    return;
  }
  change(draft => void (draft.info[id] = null));
  const read = await run(`${id}:members`, id, () => loadInfo(id));
  if (!read) change(draft => void delete draft.info[id]);
}

/** A single-use link for a new member or admin; the open invites follow when they show. */
export async function inviteToShared(id: string, role: "member" | "admin") {
  await run(`${id}:invite`, id, async () => {
    const made = await backend.sharedVaultInvite(id, role);
    change(draft => void (draft.links[id] = made));
    if (id in st().info) await loadInfo(id);
  });
}
export const closeInvite = (id: string) => change(draft => void delete draft.links[id]);
export const withdrawInvite = (id: string, invite: string) =>
  run(`${id}:withdraw`, id, async () => {
    await backend.sharedVaultInviteRevoke(id, invite);
    change(draft => {
      if (draft.links[id]?.invite.id === invite) delete draft.links[id];
    });
    await loadInfo(id);
  });
export const removeMember = (id: string, fp: string) =>
  run(`${id}:remove`, id, async () => {
    await backend.sharedVaultRemove(id, fp);
    await loadInfo(id);
  });
/** This Mac leaves the vault: it goes from the list, the folder stays as it is. */
export const leaveShared = (id: string) =>
  run(`${id}:leave`, id, async () => {
    const me = st().info[id]?.me ?? (await backend.sharedVaultInfo(id)).me;
    await backend.sharedVaultRemove(id, me);
    change(draft => {
      delete draft.info[id];
      delete draft.links[id];
      delete draft.status[id];
    });
    await reload();
  });

/** The held deletes go through in the next round, or the files come back. */
export const settleShared = (id: string, allow: boolean) =>
  run(`${id}:held`, id, async () => {
    await backend.sharedVaultHeld(id, allow);
    say(id, t(allow ? "set.sharedHeldAllowed" : "set.sharedHeldRestored"), true);
  });
