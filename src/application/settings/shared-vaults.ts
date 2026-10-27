import { t } from "../../shared/i18n";
import type { SharedRole } from "../../domain/settings/types";
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

/** Runs `work` as `busy` (its button off until it ends, whatever else ends first), its error shown under `key`. True
 *  when it worked. */
async function run(busy: string, key: string, work: () => Promise<unknown>) {
  change(draft => {
    draft.busy[busy] = true;
    draft.messages[key] = null;
  });
  try {
    await work();
    return true;
  } catch (error) {
    say(key, String(error));
    return false;
  } finally {
    change(draft => void delete draft.busy[busy]);
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

/** The join form opens with an invite link, and only then is the backend's copy taken. While a new vault's key is
 *  on screen or a create or join runs, the link waits (`invite`) and the backend keeps it: Done or the end of that run
 *  opens it here, or the next Settings window does when this one closes first. */
function openJoin(link: string) {
  const { form, busy } = st();
  if (form.recovery || busy.create || busy.join) {
    change(draft => void (draft.invite = link));
    return;
  }
  change(draft => {
    draft.form = { ...draft.form, mode: "join", link, recovery: "" };
    draft.invite = "";
    draft.messages.form = null;
  });
  void backend.sharedVaultPendingInvite();
}
/** The invite that waited for a create or join to end opens now. */
function openWaiting() {
  const link = st().invite;
  if (link) openJoin(link);
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

/** The form under the list: "new", "join" or closed (""). Closing the recovery key opens the invite that waited. */
export function openForm(mode: Shared["form"]["mode"]) {
  change(draft => {
    draft.form = { ...draft.form, mode, recovery: "" };
    draft.messages.form = null;
  });
  if (!mode) openWaiting();
}
export const editForm = (patch: Partial<Pick<Shared["form"], "machine" | "name" | "link">>) =>
  change(draft => void Object.assign(draft.form, patch));
export async function pickSharedFolder() {
  const folder = await backend.pickFolder();
  if (folder) change(draft => void (draft.form.folder = folder));
}

/** Make the vault on the machine; the form then shows its recovery key (the vault's row can show it again). */
export async function createSharedVault(machine: string) {
  const { name, folder } = st().form;
  let recovery = "";
  await run("create", "form", async () => {
    recovery = (await backend.sharedVaultCreate(machine, name, folder)).recovery;
  });
  if (!recovery) return openWaiting();
  // the key first, so a failed reload below does not hide it. A link typed into the join form meanwhile, and an invite
  // that came during the create, wait for Done.
  change(draft => {
    if (draft.form.mode === "join" && draft.form.link) draft.invite = draft.form.link;
    draft.form = { mode: "new", machine: "", name: "", folder: "", link: "", recovery };
  });
  await run("create", "form", reload);
}
export async function joinSharedVault() {
  const { link, folder } = st().form;
  const joined = await run("join", "form", () => backend.sharedVaultJoin(link.trim(), folder));
  if (joined) {
    // the invite is spent, so the form closes even when the reload fails
    change(draft => {
      if (draft.form.mode === "join")
        draft.form = { mode: "", machine: "", name: "", folder: "", link: "", recovery: "" };
    });
    await run("join", "form", reload);
  }
  // an invite link that came during the join went to `invite`, not into this form: it opens now
  openWaiting();
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
export async function inviteToShared(id: string, role: SharedRole) {
  await run(`${id}:invite`, id, async () => {
    const made = await backend.sharedVaultInvite(id, role);
    change(draft => void (draft.links[id] = made));
    if (id in st().info) await loadInfo(id);
  });
}
export const closeInvite = (id: string) => change(draft => void delete draft.links[id]);

/** The vault's recovery key shown again, for any member: this Mac holds it. */
export const showRecovery = (id: string) =>
  run(`${id}:recovery`, id, async () => {
    const key = await backend.sharedVaultRecovery(id);
    change(draft => void (draft.keys[id] = key));
  });
export const hideRecovery = (id: string) => change(draft => void delete draft.keys[id]);
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
      delete draft.keys[id];
      delete draft.status[id];
    });
    await reload();
  });

/** The held deletes the user saw (`paths`) go through in the next round, or those files come back. */
export const settleShared = (id: string, allow: boolean, paths: string[]) =>
  run(`${id}:held`, id, async () => {
    await backend.sharedVaultHeld(id, allow, paths);
    say(id, t(allow ? "set.sharedHeldAllowed" : "set.sharedHeldRestored"), true);
  });
