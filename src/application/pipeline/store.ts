import { storage } from "../../infrastructure/storage";
import { makeStore } from "../make-store";

/** A ticket waiting in a pipeline's pick column with no worker yet, as the runner last read the board. */
export type WaitingTicket = { id: string; number: string; title: string; url: string };

/** A ticket the pipeline sent to the input column before any agent started on it: nothing to build from (`bare`),
 *  the pre-flight's questions (`unclear`), or why it could not start (`failed`, in `reason`). */
export type BouncedTicket = WaitingTicket & {
  why: "bare" | "unclear" | "failed";
  questions: string[];
  reason: string;
  at: number;
};

/** What the runner last found per vault project, for the pipeline panel: why the pipeline takes no new tickets right
 *  now ("pl.usedUp", "pl.stalled", "" for nothing), the tickets waiting in its pick column with when the board was
 *  read (a hand-picked pipeline reads no pick column, so it has none), and the tickets it sent back before they
 *  started, kept across restarts (`pipelineBounced`) until they leave the input column. */
type PipelineState = {
  holding: Record<string, "" | "pl.usedUp" | "pl.stalled">;
  waiting: Record<string, { at: number; tickets: WaitingTicket[] }>;
  bounced: Record<string, BouncedTicket[]>;
  /** a ticket answered from the panel and moved to the pick column for its worker, by card id: when (the row says it
   *  waits there until the worker runs again) */
  answered: Record<string, number>;
};

export const usePipelineStore = makeStore<PipelineState>(() => ({
  holding: {},
  waiting: {},
  answered: {},
  bounced: storage.get<Record<string, BouncedTicket[]>>("pipelineBounced", {}),
}));
