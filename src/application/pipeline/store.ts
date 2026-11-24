import { makeStore } from "../make-store";

/** A ticket waiting in a pipeline's pick column with no worker yet, as the runner last read the board. */
export type WaitingTicket = { id: string; number: string; title: string; url: string };

/** What the runner last found per vault project, for the pipeline panel: why the pipeline takes no new tickets right
 *  now ("pl.usedUp", "pl.stalled", "" for nothing), and the tickets waiting in its pick column with when the board was
 *  read (a hand-picked pipeline reads no pick column, so it has none). */
type PipelineState = {
  holding: Record<string, "" | "pl.usedUp" | "pl.stalled">;
  waiting: Record<string, { at: number; tickets: WaitingTicket[] }>;
};

export const usePipelineStore = makeStore<PipelineState>(() => ({ holding: {}, waiting: {} }));
