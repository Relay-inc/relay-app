import type { Worker } from "../../domain/orchestrator/types";
import { makeStore } from "../make-store";

/** The orchestrator's workers as the backend last reported them, by conversation key. */
type OrchestratorState = { workers: Record<string, Worker> };

export const useOrchestratorStore = makeStore<OrchestratorState>(() => ({ workers: {} }));
