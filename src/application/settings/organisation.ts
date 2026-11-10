import type { OrgOffboard, OrgOverview, OrgStatus, Sso } from "../../domain/settings/types";
import * as backend from "../../infrastructure/backend";

// Settings › Machines › Organisation (docs/workspaces.md, Organisation): a server's organisation admins, its workspaces
// and people, and offboarding a person in one step. Each change is an entry this Mac signs (src-tauri organisation.rs);
// the section keeps what it shows itself, read again after each step.

/** The organisation as this Mac sees it, and for an organisation admin the overview. */
export async function loadOrganisation(machine: string): Promise<{ status: OrgStatus; overview: OrgOverview | null }> {
  const status = await backend.orgStatus(machine);
  const overview = status.me ? await backend.orgOverview(machine) : null;
  return { status, overview };
}
export const startOrganisation = (machine: string) => backend.orgStart(machine);
export const addOrgAdmin = (machine: string, fp: string, code: string) => backend.orgAddAdmin(machine, fp, code);
export const removeOrgAdmin = (machine: string, fp: string) => backend.orgRemoveAdmin(machine, fp);
export const setSso = (machine: string, sso: Sso | null) => backend.orgSso(machine, sso);
export const offboard = (machine: string, fps: string[]): Promise<OrgOffboard> => backend.orgOffboard(machine, fps);
