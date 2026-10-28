import { EMPTY_SNAPSHOT, type ProjectIcon, type Snapshot, type VaultStatus } from "../../domain/workspace/types";
import { EMPTY_NOTES, type NotesIndex } from "../../domain/workspace/rules";
import { makeStore } from "../make-store";

/** The vault: the last snapshot, the project icons, which notes exist, and the first-launch screen. */
type WorkspaceState = {
  snap: Snapshot;
  snapErr: string; // shown once in a bar at the top, gone when a later snapshot works again
  icons: Record<string, ProjectIcon>;
  notes: NotesIndex;
  /** Bumped whenever the notes that exist changed: rendered markdown depends on it, so a note made during a turn
   *  turns the [[links]] in finished answers into links. */
  notesVersion: number;
  /** No vault yet, or the configured one is gone: the welcome screen shows, starting from this status. */
  onboarding: VaultStatus | null;
  /** Per shared vault id: its live channel is connected (`shared-vaults` status), else it syncs by rounds only. */
  live: Record<string, boolean>;
};

export const useWorkspaceStore = makeStore<WorkspaceState>(() => ({
  snap: EMPTY_SNAPSHOT,
  snapErr: "",
  icons: {},
  notes: EMPTY_NOTES,
  notesVersion: 0,
  onboarding: null,
  live: {},
}));
