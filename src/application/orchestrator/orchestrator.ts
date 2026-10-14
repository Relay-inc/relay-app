import { ORCH, boardCounts, boardOrder, runningCount, splitRuns } from "../../domain/orchestrator/rules";
import type { OrchEvent, Worker } from "../../domain/orchestrator/types";
import * as backend from "../../infrastructure/backend";
import { adoptWorkers, ensureCoordinatorChat } from "../conversations/chats";
import { relayWrote } from "../conversations/history";
import { useConversationsStore } from "../conversations/store";
import { useOrchestratorStore } from "./store";
import { sendMsg } from "../conversations/actions";
import { toast } from "../navigation/navigation";
import { projectLabel } from "../workspace/vault";

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
const shown = () => boardOrder(workers(), useConversationsStore.getState().chats);
export const runningWorkers = () => runningCount(workers());
/** The workers column: the latest run and the earlier workers, the closed ones left out. */
export const workerRuns = () => splitRuns(shown());
/** The coordinator's title bar: what runs, what waits on the user, what is done. */
export const workerCounts = () => boardCounts(shown());
export const workerOf = (key: string) => useOrchestratorStore.getState().workers[key];

/** The user's answer to a blocked worker: kept on the worker (its question shows as answered) and sent to the
 *  coordinator as the user's own message, which steers the worker. */
export async function answerWorker(key: string, answer: string) {
  const worker = workerOf(key);
  const text = answer.trim();
  if (!worker || !text) return;
  const saved = await backend.orchAnswer(key, text).catch(() => null);
  if (saved) adopt([saved]);
  await sendMsg(`${projectLabel(worker.project)}, "${worker.title}": ${text}`, ORCH);
}
/** A worker that ended without a report: asked to report what it has. */
export const askReport = (key: string) => backend.orchAskReport(key).catch(error => toast(String(error)));
/** A worker started again with the same brief: a new worker in the list, the old one stays as it ended. */
export const restartWorker = (key: string) =>
  backend
    .orchRestart(key)
    .then(worker => adopt([worker]))
    .catch(error => toast(String(error)));
