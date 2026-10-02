import type { Scratch } from "../../domain/scratch/rules";
import { makeStore } from "../make-store";

type ScratchState = {
  project: string; // whose notes are loaded
  notes: Scratch[];
  open: string; // the key of the note shown, "" for none
};

export const useScratchStore = makeStore<ScratchState>(() => ({ project: "", notes: [], open: "" }));
