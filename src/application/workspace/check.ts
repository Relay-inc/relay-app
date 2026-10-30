import * as backend from "../../infrastructure/backend";
import { isAdmin } from "../navigation/pages";
import { activeFolder } from "../navigation/workspaces";
import { loadSnapshot } from "./vault";

// The workspace check: what the workspace shown lacks to work for every member's Claude, and its repair.
export type { VaultFinding } from "../../infrastructure/backend";
export const checkWorkspace = () => backend.vaultCheck(activeFolder());
/** Only an admin repairs a shared workspace: what Repair writes reaches every member. */
export const canRepair = () => isAdmin(activeFolder());
/** Repairs these findings, then reads the projects again. Returns how many were repaired. */
export async function repairWorkspace(ids: string[]) {
  const n = await backend.vaultRepair(activeFolder(), ids);
  await loadSnapshot();
  return n;
}
