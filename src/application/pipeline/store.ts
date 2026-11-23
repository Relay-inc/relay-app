import { makeStore } from "../make-store";

/** Why each pipeline takes no new tickets right now ("pl.usedUp", "pl.stalled", "" for nothing), by vault project, as
 *  the runner last found it: the pipeline panel shows it. */
type PipelineState = { holding: Record<string, "" | "pl.usedUp" | "pl.stalled"> };

export const usePipelineStore = makeStore<PipelineState>(() => ({ holding: {} }));
