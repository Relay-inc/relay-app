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
  /** where each ticket with a pipeline worker is on the board, as the runner last read it, kept up to date with the
   *  runner's own moves: card id to column id ("" when the ticket was not on the board), the board's column names,
   *  and when it was read. The panel shows a ticket by this, not by what its worker last reported */
  columns: Record<string, { at: number; of: Record<string, string>; names: Record<string, string> }>;
  /** a ticket answered from the panel and moved to the pick column for its worker, by card id: when (the row says it
   *  waits there until the worker runs again) */
  answered: Record<string, number>;
};

export const usePipelineStore = makeStore<PipelineState>(() => ({
  holding: {},
  waiting: {},
  columns: {},
  answered: {},
  bounced: storage.get<Record<string, BouncedTicket[]>>("pipelineBounced", {}),
}));
