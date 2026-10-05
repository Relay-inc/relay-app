import { onPill, type PillState } from "../../infrastructure/backend";
import { makeStore } from "../make-store";

// The dictation pill's window (overlay.html, src-tauri/src/anywhere.rs): what the backend sends it, plus the last few
// levels for the bars.
const BARS = 7;
type PillView = { state: PillState; levels: number[] };
export const usePillStore = makeStore<PillView>(() => ({ state: { phase: "hidden" }, levels: Array(BARS).fill(0) }));

export const listenToPill = () =>
  onPill(state =>
    usePillStore.setState(draft => {
      draft.state = state;
      draft.levels = state.phase === "recording" ? [...draft.levels.slice(1), state.level ?? 0] : Array(BARS).fill(0);
    }),
  );
