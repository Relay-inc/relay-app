import type { BrainNote, BrainStatus } from "../../domain/brain/types";
import { makeStore } from "../make-store";

type BrainState = {
  status: BrainStatus | null;
  notes: BrainNote[] | null; // null until loaded, and while the plugin is off
  open: string; // the key of the note shown
  err: string;
  busy: boolean;
  acting: boolean; // a promote or reject is running
  installing: boolean; // the plugin install in Settings is running
  installErr: string;
};

export const useBrainStore = makeStore<BrainState>(() => ({
  status: null,
  notes: null,
  open: "",
  err: "",
  busy: false,
  acting: false,
  installing: false,
  installErr: "",
}));
