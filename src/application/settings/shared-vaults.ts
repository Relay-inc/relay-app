import { t } from "../../shared/i18n";
import type { SharedRole } from "../../domain/settings/types";
import * as backend from "../../infrastructure/backend";
import { checkMachine } from "./machines-page";
import { useSettingsStore, type SettingsState } from "./store";

// Settings › Machines: workspaces a team shares on a relay-server, each synced into a folder here
// (src-tauri/src/shared_vaults.rs), under the machine that keeps it or, joined with a link, in Workspaces. The backend keeps the list in the settings and runs the rounds; a round's result
// comes in as an event. Invites, members and leaving go to the server through the backend.
type Shared = SettingsState["shared"];
const st = () => useSettingsStore.getState().shared;
const change = (recipe: (draft: Shared) => void) => useSettingsStore.setState(draft => recipe(draft.shared));
const CLOSED: Shared["form"] = { mode: "", machine: "", name: "", folder: "", link: "" };

/** Runs `work` with `key` busy: a vault's id (its row's buttons off until it ends) or "form". Its error shows under
 *  `key`. True when it worked. */
async function run(key: string, work: () => Promise<unknown>) {
  change(draft => {
    draft.busy[key] = true;
    draft.messages[key] = null;
  });
  try {
    await work();
    return true;
  } catch (error) {
    change(draft => void (draft.messages[key] = { text: String(error), ok: false }));
    return false;
  } finally {
    change(draft => void delete draft.busy[key]);
  }
}

/** The settings and the extra vaults read again: the backend changed the list of shared vaults itself. A server it
 *  added under Machines (this Mac is admin of a vault there) is checked, for its Update. */
async function reload() {
  const [settings, extraVaults] = await Promise.all([backend.getSettings(), backend.extraVaultsStatus()]);
  useSettingsStore.setState(draft => {
    draft.settings = settings;
    draft.extraVaults = extraVaults;
  });
  const status = useSettingsStore.getState().machinesPage.status;
  for (const machine of settings.machines ?? []) if (!(machine.id in status)) checkMachine(machine.id);
}

/** The invite link the backend keeps (the one that opened Relay, or came since) into the join form. While a create or
 *  join runs it stays there: their end takes it, or the next Settings window. `open_settings` shows Machines. */
export async function takeInvite() {
  if (st().busy.form) return;
  const link = await backend.sharedVaultPendingInvite().catch(() => null);
  if (!link) return;
  change(draft => {
    draft.form = { ...draft.form, mode: "join", machine: "", link };
    draft.messages.form = null;
  });
}

/** The rounds so far and then each one as it ends, and the invite links (`vault-invite` is a ping: the backend has
 *  the link). Once, when the window opens. */
export async function watchSharedVaults() {
  void backend.onSharedVaults(status =>
    change(draft => {
      draft.status = status;
      // what a choice on held deletes said (the row's only ok message) goes once that vault holds none
      for (const [id, round] of Object.entries(status))
        if (!round.held.length && draft.messages[id]?.ok) draft.messages[id] = null;
    }),
  );
  void backend.onVaultInvite(takeInvite);
  try {
    const status = await backend.sharedVaultsStatus();
    change(draft => void (draft.status = status));
  } catch {
    // an older backend: no shared vaults
  }
  await takeInvite();
}

/** The one form, "new", "join" or closed (""), and where it shows with its message: under the machine `machine`
 *  (a new vault there), or in Workspaces when "" (joining). */
export function openForm(mode: Shared["form"]["mode"], machine = st().form.machine) {
  change(draft => {
    draft.form = { ...draft.form, mode, machine };
    draft.messages.form = null;
  });
}
export const editForm = (patch: Partial<Pick<Shared["form"], "name" | "link">>) =>
  change(draft => void Object.assign(draft.form, patch));
export async function pickSharedFolder() {
  const folder = await backend.pickFolder();
  if (folder) change(draft => void (draft.form.folder = folder));
}

/** Make the vault on the form's machine: the form closes and its row shows the recovery key (a failed reload leaves
 *  it to Show recovery key). */
export async function createSharedVault() {
  const { machine, name, folder } = st().form;
  await run("form", async () => {
    const { id, recovery } = await backend.sharedVaultCreate(machine, name, folder);
    change(draft => {
      draft.keys[id] = recovery;
      draft.form = { ...CLOSED, machine }; // what the reload says shows under that machine
    });
    await reload();
  });
  await takeInvite();
}
export async function joinSharedVault() {
  const { link, folder } = st().form;
  await run("form", async () => {
    await backend.sharedVaultJoin(link.trim(), folder);
    change(draft => void (draft.form = CLOSED)); // the invite is spent: closed also when the reload fails
    await reload();
  });
  await takeInvite();
}

/** The members and open invites read again, when they show. */
async function loadInfo(id: string) {
  const info = await backend.sharedVaultInfo(id);
  change(draft => {
    if (id in draft.info) draft.info[id] = info;
  });
  // a role that changed there: the backend saved it, with the server under Machines for an admin (or gone again)
  const saved = useSettingsStore.getState().settings.sharedVaults?.find(vault => vault.id === id)?.role;
  if (info.vault.role && info.vault.role !== saved) await reload();
}
/** The members shown or folded away. */
export async function toggleMembers(id: string) {
  if (id in st().info) {
    change(draft => void delete draft.info[id]);
    return;
  }
  change(draft => void (draft.info[id] = null));
  const read = await run(id, () => loadInfo(id));
  if (!read) change(draft => void delete draft.info[id]);
}

/** A single-use link for a new member or admin; the open invites follow when they show. */
export async function inviteToShared(id: string, role: SharedRole) {
  await run(id, async () => {
    const made = await backend.sharedVaultInvite(id, role);
    change(draft => void (draft.links[id] = made));
    if (id in st().info) await loadInfo(id);
  });
}
export const closeInvite = (id: string) => change(draft => void delete draft.links[id]);

/** The vault's recovery key shown again, for any member: this Mac holds it. */
export const showRecovery = (id: string) =>
  run(id, async () => {
    const key = await backend.sharedVaultRecovery(id);
    change(draft => void (draft.keys[id] = key));
  });
export const hideRecovery = (id: string) => change(draft => void delete draft.keys[id]);
export const withdrawInvite = (id: string, invite: string) =>
  run(id, async () => {
    await backend.sharedVaultInviteRevoke(id, invite);
    change(draft => {
      if (draft.links[id]?.invite.id === invite) delete draft.links[id];
    });
    await loadInfo(id);
  });
/** An admin turns making the workspace's notes documents on or off (docs/workspaces.md, Documents). */
export const setSharedDocs = (id: string, on: boolean) =>
  run(id, async () => {
    await backend.sharedVaultDocs(id, on);
    change(draft => {
      const s = draft.status[id];
      if (s) s.docs = on;
    });
  });
/** An admin trusts a member's new key, after they said they set up Relay again (docs/workspaces.md, Key rotation). */
export const trustMember = (id: string, fp: string) =>
  run(id, async () => {
    await backend.sharedVaultTrust(id, fp);
    change(draft => {
      const s = draft.status[id];
      if (s) s.changed = (s.changed ?? []).filter(c => c.fp !== fp);
    });
  });
/** An admin makes a member an admin, or an admin a member again (docs/workspaces.md, Members). */
export const setMemberAdmin = (id: string, fp: string, on: boolean) =>
  run(id, async () => {
    await backend.sharedVaultAdmin(id, fp, on);
    change(draft => {
      const s = draft.status[id];
      if (s?.admins) s.admins = on ? [...s.admins.filter(a => a !== fp), fp] : s.admins.filter(a => a !== fp);
    });
    await loadInfo(id);
  });
export const removeMember = (id: string, fp: string) =>
  run(id, async () => {
    await backend.sharedVaultRemove(id, fp);
    await loadInfo(id);
  });
/** This Mac leaves the vault: it goes from the list, the folder stays as it is. */
export const leaveShared = (id: string) =>
  run(id, async () => {
    // "" is this Mac to the backend: a member that was removed, or whose vault is gone, cannot ask the server who it is
    await backend.sharedVaultRemove(id, st().info[id]?.me ?? "");
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
  run(id, async () => {
    await backend.sharedVaultHeld(id, allow, paths);
    change(
      draft =>
        void (draft.messages[id] = { text: t(allow ? "set.sharedHeldAllowed" : "set.sharedHeldRestored"), ok: true }),
    );
  });
