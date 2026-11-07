import * as backend from "../../infrastructure/backend";
import { t } from "../../shared/i18n";
import { toast } from "../navigation/navigation";
import { loadChanges } from "../navigation/changes";
import { isAdmin } from "../navigation/pages";
import { activeFolder } from "../navigation/workspaces";
import { loadSnapshot, projectLabel } from "./vault";
import { useWorkspaceStore } from "./store";

// The workspace check: what the workspace shown lacks to work for every member's Claude, and its repair.
export type { TidyPlan, VaultFinding } from "../../infrastructure/backend";
export const checkWorkspace = () => backend.vaultCheck(activeFolder());
/** Only an admin repairs a shared workspace: what Repair writes reaches every member. */
export const canRepair = () => isAdmin(activeFolder());
/** Repairs these findings, then reads the projects again. Returns how many were repaired. */
export async function repairWorkspace(ids: string[]) {
  const n = await backend.vaultRepair(activeFolder(), ids);
  await loadSnapshot();
  return n;
}

/** What Tidy structure would do, read now and not written. */
export const tidyPreview = () => backend.tidyPreview(activeFolder());
/** Moves every note to its home as one run, then reads the workspace again. */
export async function tidyApply() {
  const plan = await backend.tidyApply(activeFolder());
  await loadSnapshot();
  return plan;
}
/** Puts the last Tidy structure back, then reads the workspace again. */
export async function tidyUndo() {
  await backend.tidyUndo(activeFolder());
  await loadSnapshot();
}

/** The garden: where the notes decay (orphans, broken links, notes without type, …), read now. */
export const gardenWorkspace = () => backend.vaultGarden(activeFolder());
/** The projects of the workspace shown, for a meeting's picker: `name` is what `about:` links to. */
export function workspaceProjects() {
  const { snap } = useWorkspaceStore.getState();
  return snap.projects
    .filter(project => (project.vault || snap.vault?.vault) === activeFolder())
    .map(project => ({ id: project.name.split("\u001f")[0], name: projectLabel(project.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
/** A meeting's project picked: its `about:` now links to it. */
export async function setAbout(path: string, project: string) {
  await backend.gardenAbout(activeFolder(), path, project);
  await loadSnapshot();
}
/** Claude does `action` (properties or about) on these notes in the background; what it writes lands in the Changes
 *  feed as one entry, each note with Undo. */
export async function askClaude(action: "properties" | "about", paths: string[]) {
  const folder = activeFolder();
  toast(t("garden.working"), undefined, "", 4000);
  try {
    await backend.gardenAsk(folder, action, paths);
  } catch (e) {
    toast(String(e));
  }
  await loadChanges(folder);
}
