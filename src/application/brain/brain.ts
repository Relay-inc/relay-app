import { brainKey } from "../../domain/brain/rules";
import type { BrainNote } from "../../domain/brain/types";
import * as backend from "../../infrastructure/backend";
import { cwOn } from "../../domain/settings/types";
import { settings } from "../settings/settings";
import { useBrainStore } from "./store";

const set = useBrainStore.setState;

/** Once its Claude Code plugin is installed, unless switched off in Settings. */
export const brainOn = () => !!useBrainStore.getState().status?.plugin && cwOn(settings());
/** The plugin's state and the CLI, for Settings. */
export async function loadBrainStatus() {
  try {
    const status = await backend.commonwealthStatus();
    set(draft => {
      draft.status = status;
    });
  } catch (e) {
    set(draft => {
      draft.installErr = String(e);
    });
  }
}
/** Refreshed every 5 minutes, on focus and on opening the view. */
export async function loadBrain() {
  if (useBrainStore.getState().busy) return;
  set(draft => {
    draft.busy = true;
  });
  try {
    const status = await backend.commonwealthStatus();
    const notes = status.plugin ? await backend.commonwealthNotes() : null;
    set(draft => {
      draft.status = status;
      draft.notes = notes;
      if (!notes?.some(note => brainKey(note) === draft.open)) draft.open = "";
      draft.err = "";
    });
  } catch (e) {
    set(draft => {
      draft.err = String(e);
    });
  }
  set(draft => {
    draft.busy = false;
  });
}
export const openNote = (key: string) =>
  set(draft => {
    draft.open = key;
  });
export async function brainAct(note: BrainNote, verb: "promote" | "reject") {
  if (useBrainStore.getState().acting) return;
  set(draft => {
    draft.acting = true;
    draft.err = "";
  });
  try {
    await backend.commonwealthAct(note.brain, verb, [note.id]);
  } catch (e) {
    set(draft => {
      draft.err = String(e);
    });
  }
  set(draft => {
    draft.acting = false;
  });
  await loadBrain();
}
export async function installCommonwealth() {
  set(draft => {
    draft.installing = true;
    draft.installErr = "";
  });
  try {
    await backend.commonwealthInstall();
  } catch (e) {
    set(draft => {
      draft.installErr = String(e);
    });
  }
  set(draft => {
    draft.installing = false;
  });
  await loadBrainStatus();
}
