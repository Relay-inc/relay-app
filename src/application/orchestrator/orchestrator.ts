import { boardOrder, runningCount } from "../../domain/orchestrator/rules";
import type { OrchEvent, Worker } from "../../domain/orchestrator/types";
import * as backend from "../../infrastructure/backend";
import { adoptWorkers, ensureCoordinatorChat } from "../conversations/chats";
import { relayWrote } from "../conversations/history";
import { useOrchestratorStore } from "./store";

// The orchestrator's workers as the backend reports them: the list at start, the `orch` events after it, and stopping
// one. Their conversations belong to the conversations context, which this one asks to make them.

function adopt(workers: Worker[]) {
  useOrchestratorStore.setState(draft => {
    for (const worker of workers) draft.workers[worker.key] = worker;
  });
  adoptWorkers(workers);
}

/** At start: the coordinator's conversation, and a conversation for every worker, also the ones made while no page listened. */
export async function loadWorkers() {
  ensureCoordinatorChat();
  adopt((await backend.orchWorkers().catch(() => null)) ?? []);
}

/** The backend's `orch` event. */
export function onOrchEvent(event: OrchEvent) {
  if (event.type === "worker") adopt([event.worker]);
  else relayWrote(event.key, event.text);
}

/** The board's Stop: the backend stops the worker and reports its new state. */
export const stopWorker = (key: string) => backend.orchStop(key).catch(() => false);

const workers = () => Object.values(useOrchestratorStore.getState().workers);
/** The workers as the board shows them, newest first. */
export const workerBoard = () => boardOrder(workers());
export const runningWorkers = () => runningCount(workers());
