import { permissions, permissionsOpen } from "../../infrastructure/backend";
import { makeStore } from "../make-store";

// Settings › General › Permissions: what macOS lets Relay do, asked again while the page shows, since each one is
// switched in System Settings (src-tauri/src/permissions.rs).
export type PermissionState = "ok" | "missing" | "ask" | null;
export const PERMISSIONS = ["fullDisk", "microphone", "systemAudio", "accessibility", "notifications"] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const usePermissionsStore = makeStore<{ states: Partial<Record<Permission, PermissionState>> }>(() => ({
  states: {},
}));

export async function loadPermissions() {
  const states = await permissions().catch(() => ({}));
  usePermissionsStore.setState(draft => {
    draft.states = states;
  });
}
export const openPermission = (which: Permission) => permissionsOpen(which).catch(() => {});
