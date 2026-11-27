import type { BackgroundTask } from "../agents/types";
import type { BgTask } from "./types";

/** How long a finished task stays in the list with its result (ms). */
export const TASK_LINGER = 8000;

/** The tasks after Claude Code's list changed: its set replaces the running ones (a task already known keeps its start
 *  and progress), and a task that ended stays a few seconds with its result. */
export function applyTasks(known: BgTask[] = [], listed: BackgroundTask[], now: number): BgTask[] {
  const old = new Map(known.map(task => [task.id, task]));
  const live = listed.map((t): BgTask => {
    const k = old.get(t.id);
    // one that already ended keeps its result while the set still lists it
    if (k && k.status !== "running") return k;
    return {
      ...k,
      id: t.id,
      kind: t.kind,
      agent: t.agent ?? undefined,
      description: t.description,
      since: k?.since ?? now,
      status: "running",
    };
  });
  const ids = new Set(listed.map(t => t.id));
  const lingering = known.filter(t => t.status !== "running" && !ids.has(t.id) && now - (t.end ?? now) < TASK_LINGER);
  return [...live, ...lingering];
}

/** A task ended: its state and when, kept in the list for a few seconds. */
export function endTask(tasks: BgTask[] = [], id: string, status: BgTask["status"], now: number): BgTask[] {
  return tasks.map(t => (t.id === id && t.status === "running" ? { ...t, status, end: now } : t));
}

/** What the list shows at `now`: the running tasks and the ones that ended a moment ago. */
export const shownTasks = (tasks: BgTask[], now: number) =>
  tasks.filter(t => t.status === "running" || now - (t.end ?? 0) < TASK_LINGER);
