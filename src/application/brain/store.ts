import type { BrainGraph, BrainNote, BrainRoot, BrainStatus, SearchHit, Touch } from "../../domain/brain/types";
import { makeStore } from "../make-store";

export type BrainMode = "browse" | "graph" | "review";
type BrainState = {
  status: BrainStatus | null;
  notes: BrainNote[] | null; // the review queue: null until loaded, and while the plugin is off
  open: string; // the key of the staged note shown in Review
  err: string;
  busy: boolean;
  acting: boolean; // a promote or reject is running
  installing: boolean; // the plugin install in Settings is running
  installErr: string;
  joining: boolean; // `commonwealth join` in Settings is running
  joined: string; // its report, "" until it ran
  joinErr: string;
  // ---------- browse and graph
  roots: BrainRoot[] | null; // the vault first, then the brains (when Commonwealth is on)
  tab: string; // the root shown, "" for the first
  mode: BrainMode;
  graphs: Record<string, BrainGraph>; // per root, loaded on first view and on every refresh
  graphErr: string;
  note: { root: string; path: string; text: string } | null; // the note shown in Browse
  query: string;
  hits: SearchHit[] | null; // for `query`, null while there is none
  hideHubs: boolean;
  glow: boolean;
  glowKey: string; // only this conversation's notes glow, "" for all
  touches: Touch[] | null;
  touchesSince: number; // ms: the start of the glow window when they were loaded
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
  joining: false,
  joined: "",
  joinErr: "",
  roots: null,
  tab: "",
  mode: "browse",
  graphs: {},
  graphErr: "",
  note: null,
  query: "",
  hits: null,
  hideHubs: true,
  glow: false,
  glowKey: "",
  touches: null,
  touchesSince: 0,
}));
