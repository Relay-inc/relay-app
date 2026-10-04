import { t } from "../../shared/i18n";
import type { Machine } from "../../domain/settings/types";
import { excludePath, SETUP_FOLDERS, type SetupPlatform } from "../../domain/settings/machines";
import * as backend from "../../infrastructure/backend";
import { checkAgents } from "./agents-page";
import { commit } from "./window";
import { useSettingsStore } from "./store";

// Settings › Machines: other computers in the LAN running relay-server. Pairing, the online check and the mirror on
// each machine. The backend saves machines itself; the window then reads the settings again.
const st = () => useSettingsStore.getState();
type Page = ReturnType<typeof st>["machinesPage"];
const change = (recipe: (draft: Page) => void) =>
  useSettingsStore.setState(draft => {
    recipe(draft.machinesPage);
  });
const machines = () => st().settings.machines ?? [];
const reload = async () => commit(await backend.getSettings());

/** When the page first shows: whether every machine is online. */
export function showMachinesPage() {
  if (st().machinesPage.checked) return;
  change(draft => {
    draft.checked = true;
  });
  checkAll();
  backend
    .serverSetup()
    .then(setup =>
      change(draft => {
        draft.setup = setup;
      }),
    )
    .catch(() => {}); // an older backend: no setup section
  refreshHost();
}
/** Reads this Mac as a machine, and what Claude Code here is (the Agents check, kept shown meanwhile). */
export function refreshHost() {
  backend
    .hostStatus()
    .then(host =>
      change(draft => {
        draft.host = host;
      }),
    )
    .catch(() => {}); // an older backend: no section
  checkAgents(true);
}
/** Turns this Mac as a machine on or off. */
export async function setHost(on: boolean) {
  change(draft => {
    draft.hostError = "";
    if (!on) draft.hostLine = "";
  });
  try {
    const host = await backend.hostSet(on);
    change(draft => {
      draft.host = host;
    });
  } catch (error) {
    change(draft => {
      draft.hostError = String(error);
    });
    refreshHost();
  }
}
/** Makes a pairing line for another Mac. */
export async function makeHostLine() {
  change(draft => {
    draft.hostError = "";
  });
  try {
    const line = await backend.hostPair();
    change(draft => {
      draft.hostLine = line;
    });
  } catch (error) {
    change(draft => {
      draft.hostError = String(error);
    });
  }
}
export async function checkMachine(id: string) {
  change(draft => {
    draft.status[id] = "checking";
  });
  const status = await backend.machineStatus(id).catch(error => ({ ok: false, error: String(error) }));
  change(draft => {
    draft.status[id] = status;
  });
}
export const checkAll = () => machines().forEach(machine => checkMachine(machine.id));

/** Pair with the line `relay-server pair` printed; true when it worked, so the page empties its fields. */
export async function pairMachine(line: string, name: string) {
  change(draft => {
    draft.pairing = true;
    draft.pairError = "";
  });
  try {
    const machine = await backend.machinePair(line, name);
    await reload();
    checkMachine(machine.id);
    return true;
  } catch (error) {
    change(draft => {
      draft.pairError = String(error);
    });
    return false;
  } finally {
    change(draft => {
      draft.pairing = false;
    });
  }
}
/** Update a machine's relay-server to this Relay's version, sent from here; then check it again. */
export async function updateMachine(id: string) {
  change(draft => {
    draft.updating = id;
    draft.messages[id] = null;
  });
  try {
    const { version } = await backend.machineUpdate(id);
    change(draft => {
      draft.messages[id] = { text: t("mc.updated", { version }), ok: true };
    });
  } catch (error) {
    change(draft => {
      draft.messages[id] = { text: String(error), ok: false };
    });
  } finally {
    change(draft => {
      draft.updating = "";
    });
    checkMachine(id);
  }
}
export async function forgetMachine(id: string) {
  try {
    await backend.machineForget(id);
    await reload();
  } catch (error) {
    change(draft => {
      draft.messages[id] = { text: String(error), ok: false };
    });
  }
}

/** Where new conversations run without a pick: "" this Mac, or a machine id. Resolves with an error to show, or "". */
export async function setRunDefault(id: string) {
  try {
    await backend.setMachinesDefault(id);
    await reload();
    return "";
  } catch (error) {
    return String(error);
  }
}

// The mirror: every machine keeps a sealed copy of the Claude context, plugins, vault and its memory. A failed
// command shows under the mirror section and leaves the page as it was.
const mirrorMessage = (id: string, text: string, ok = false) =>
  change(draft => {
    draft.mirrorMessages[id] = text ? { text, ok } : null;
  });
/** Reads the last mirror round and the running one of every machine; a failing command keeps what was there. */
export async function pollMirrors() {
  for (const machine of machines()) {
    const [status, progress] = await Promise.all([
      backend.mirrorStatus(machine.id).catch(() => undefined),
      backend.mirrorProgress(machine.id).catch(() => undefined),
    ]);
    change(draft => {
      if (status !== undefined) draft.mirror[machine.id] = status;
      if (progress !== undefined) draft.mirrorProgress[machine.id] = progress;
    });
  }
}
/** Saves the excluded folders. True when it worked. */
async function saveExclude(machine: Machine, exclude: string[]) {
  mirrorMessage(machine.id, "");
  try {
    await backend.setMachineMirror(machine.id, exclude);
    await reload();
    pollMirrors();
    return true;
  } catch (error) {
    mirrorMessage(machine.id, String(error));
    return false;
  }
}
/** Adds a vault folder to the ones that stay on this Mac. Resolves with an error to show, or "". */
export async function addMirrorExclude(machine: Machine, input: string) {
  const path = excludePath(input);
  if (!path) return t("mc.mirrorErrExclude");
  const current = machine.mirror?.exclude ?? [];
  if (current.includes(path)) return "";
  return (await saveExclude(machine, [...current, path])) ? "" : t("mc.mirrorErrSave");
}
export const removeMirrorExclude = (machine: Machine, path: string) =>
  saveExclude(
    machine,
    (machine.mirror?.exclude ?? []).filter(item => item !== path),
  );
/** The kind of machine the setup commands are for, with that kind's folder. */
export const setSetupPlatform = (platform: SetupPlatform) =>
  change(draft => {
    draft.setupPlatform = platform;
    draft.setupFolder = SETUP_FOLDERS[platform];
  });
/** How a Mac becomes a machine: with the Relay app, or with Docker. */
export const setSetupMacWay = (way: "app" | "docker") =>
  change(draft => {
    draft.setupMacWay = way;
  });
/** The folder on the machine the setup commands use. */
export const setSetupFolder = (folder: string) =>
  change(draft => {
    draft.setupFolder = folder;
  });
