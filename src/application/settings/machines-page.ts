import { t } from "../../shared/i18n";
import type { Machine } from "../../domain/settings/types";
import { folderRows, foldersOf, type FolderRow } from "../../domain/settings/machines";
import * as backend from "../../infrastructure/backend";
import { commit } from "./window";
import { useSettingsStore } from "./store";

// Settings › Machines: other computers in the LAN running relay-server. Pairing, the online check and the project
// folders on each machine. The backend saves machines itself; the window then reads the settings again.
const st = () => useSettingsStore.getState();
type Page = ReturnType<typeof st>["machinesPage"];
const change = (recipe: (draft: Page) => void) =>
  useSettingsStore.setState(draft => {
    recipe(draft.machinesPage);
  });
const machines = () => st().settings.machines ?? [];
const reload = async () => commit(await backend.getSettings());

/** When the page first shows: the vault's projects, and whether every machine is online. */
export async function showMachinesPage() {
  if (st().machinesPage.checked) return;
  change(draft => {
    draft.checked = true;
  });
  checkAll();
  const snapshot = await backend.snapshot().catch(() => ({ projects: [] }));
  const projects = (snapshot.projects || []).map(project => String(project.name)).sort((a, b) => a.localeCompare(b));
  change(draft => {
    draft.projects = projects;
  });
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

/** A machine's folder rows: the draft, else what is saved. */
const rowsOf = (machine: Machine): FolderRow[] => st().machinesPage.drafts[machine.id] ?? folderRows(machine);
/** One edit to a machine's folder rows; it stays a draft until Save. */
export function editRows(machine: Machine, edit: (rows: FolderRow[]) => void) {
  const rows = rowsOf(machine).map(row => ({ ...row }));
  edit(rows);
  change(draft => {
    draft.drafts[machine.id] = rows;
    draft.messages[machine.id] = null;
  });
}
export async function saveFolders(machine: Machine) {
  const folders = foldersOf(rowsOf(machine));
  if (!folders)
    return change(draft => {
      draft.messages[machine.id] = { text: t("mc.errPath"), ok: false };
    });
  try {
    await backend.setMachineFolders(machine.id, folders);
    await reload();
    change(draft => {
      delete draft.drafts[machine.id];
      draft.messages[machine.id] = { text: t("set.saved"), ok: true };
    });
  } catch (error) {
    change(draft => {
      draft.messages[machine.id] = { text: String(error), ok: false };
    });
  }
}
/** The folder used on the machine when a project has none there: an absolute path, or empty for its home. Resolves with
 *  an error to show, or "". */
export async function saveDefaultFolder(machine: Machine, folder: string) {
  const path = folder.trim();
  if (path && !path.startsWith("/")) return t("mc.errDefaultFolder");
  try {
    await backend.setMachineDefaultFolder(machine.id, path);
    await reload();
    return "";
  } catch (error) {
    return String(error);
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
