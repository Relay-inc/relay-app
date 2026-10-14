import type { Chat, Item } from "../conversations/types";
import type { Worker } from "./types";

// The orchestrator: one permanent coordinating conversation (`ORCH`) that starts worker conversations in vault projects
// through its own tools (src-tauri). Each worker is a normal conversation under its project, its report comes back into
// the coordinator as a user turn Relay writes itself.

/** The coordinator's conversation key: one, permanent. */
export const ORCH = "c:orch";
const WORKER_PREFIX = "c:orch-w-";
/** What Relay puts in front of a turn it writes itself: a worker's brief, a report into the coordinator. */
export const RELAY_PREFIX = "[Relay] ";

/** The coordinator or one of its workers: in this version they only run on this Mac. */
export const isOrchKey = (key: string) => key === ORCH || key.startsWith(WORKER_PREFIX);
/** A turn Relay wrote, not the user: shown as its own block, live and from the transcript. */
export const isRelayTurn = (text: string) => text.startsWith(RELAY_PREFIX);
export const relayText = (text: string) => (isRelayTurn(text) ? text.slice(RELAY_PREFIX.length) : text);
/** Whether the last user turn of a conversation is this text already (a transcript read just before the event). */
export const lastTurnIs = (items: Item[] | undefined, text: string) =>
  [...(items || [])].reverse().find(item => item.kind === "me")?.text === text;

/** The board: newest first, without the workers whose conversation was closed (reopening it brings the worker back). */
export const boardOrder = (workers: Iterable<Worker>, chats: Record<string, Chat> = {}) =>
  [...workers].filter(worker => !chats[worker.key]?.closed).sort((newer, older) => older.at - newer.at);
/** A worker's crab (ui/features/orchestrator/Crab): a board pipeline's worker is the engineer, else its model's. */
export type Costume = "fable" | "opus" | "sonnet" | "haiku" | "pipeline" | "plain";
export const costumeOf = (model: string | undefined, pipeline: boolean): Costume => {
  if (pipeline) return "pipeline";
  const name = (model ?? "").toLowerCase();
  return (["fable", "opus", "sonnet", "haiku"] as const).find(family => name.includes(family)) ?? "plain";
};
const NAMES = [
  "Pinchy",
  "Sheldon",
  "Snappy",
  "Bubbles",
  "Coral",
  "Barnacle",
  "Kelp",
  "Scuttle",
  "Nipper",
  "Krill",
  "Shelly",
  "Pebble",
  "Sandy",
  "Marina",
  "Gill",
  "Finn",
  "Pearl",
  "Wade",
  "Reef",
  "Tide",
  "Crusty",
  "Hermie",
  "Bisque",
  "Paddle",
  "Dune",
  "Moss",
  "Skipper",
  "Rocky",
  "Salty",
  "Squirt",
  "Mussel",
  "Cove",
  "Drift",
  "Ripple",
  "Pip",
  "Sprocket",
  "Clem",
  "Nemo",
  "Brine",
  "Wavelet",
  "Limpet",
  "Urchin",
  "Captain",
  "Dory",
  "Spindle",
  "Taffy",
  "Pickles",
  "Bramble",
];
/** A worker's name, picked by its key (its random part), so it is the same everywhere and after a restart. */
export function workerName(key: string) {
  let hash = 2166136261; // FNV-1a
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
  return NAMES[(hash >>> 0) % NAMES.length];
}
/** What a worker waits on the user for: the question of its blocked or done report (until answered), or a turn that
 *  ended without a report (ask for it, or start it again). */
export type Need = { kind: "ask"; question: string; options: string[] } | { kind: "silent" };
export function needOf(worker: Worker): Need | null {
  if (worker.state === "silent") return { kind: "silent" };
  const question = worker.report?.questions?.trim();
  if ((worker.state !== "blocked" && worker.state !== "done") || worker.answer || !question) return null;
  return { kind: "ask", question, options: worker.report?.options ?? [] };
}
/** The title bar's summary: what runs, what waits on the user, what is done. */
export function boardCounts(workers: Worker[]) {
  return {
    running: workers.filter(worker => worker.state === "running").length,
    need: workers.filter(worker => needOf(worker)).length,
    done: workers.filter(worker => worker.state === "done").length,
  };
}
// ponytail: a run is a burst of dispatches (each worker started within RUN_GAP of the one after it), not the
// coordinator turn that started them; mark workers with their turn in the backend if bursts start to merge
const RUN_GAP = 20 * 60_000;
/** The workers list: the latest run (newest first, and when it started) and the earlier workers. */
export function splitRuns(workers: Iterable<Worker>) {
  const sorted = boardOrder(workers);
  let n = sorted.length ? 1 : 0;
  while (n < sorted.length && sorted[n - 1].at - sorted[n].at <= RUN_GAP) n++;
  return { run: sorted.slice(0, n), since: sorted[n - 1]?.at ?? 0, earlier: sorted.slice(n) };
}
/** The worker a report Relay wrote into the coordinator is from ("Report from worker c:orch-w-…"). */
export const reportKey = (text: string) => /Report from worker (c:orch-w-[a-z0-9]+)/.exec(text)?.[1] ?? null;
export const runningCount = (workers: Iterable<Worker>) =>
  [...workers].filter(worker => worker.state === "running").length;

/** The coordinator's conversation as the sidebar and the composer need it, whatever an older entry said. */
export function ensureCoordinator(chats: Record<string, Chat>) {
  const existing = chats[ORCH];
  chats[ORCH] = {
    ...existing,
    key: ORCH,
    project: null,
    title: "Orchestrator",
    at: existing?.at ?? 0,
    draft: false,
    provider: "claude",
  };
  delete chats[ORCH].closed;
}

/** A worker's conversation, made when it is new. One adopted from the backend's list before the app knew it was a worker
 *  gets the worker's project and title; a known worker keeps what the user changed. True when something changed. */
export function ensureWorkerChat(chats: Record<string, Chat>, worker: Worker): boolean {
  const existing = chats[worker.key];
  if (existing?.orch) return false;
  chats[worker.key] = {
    ...existing,
    key: worker.key,
    at: existing?.at ?? worker.at,
    project: worker.project,
    title: worker.title,
    draft: false,
    provider: "claude",
    orch: true,
  };
  return true;
}
