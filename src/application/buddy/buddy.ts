import { lastRunOf, pipesOf, type BuddyRef, type Pipe, type Run } from "../../domain/buddy/rules";
import * as backend from "../../infrastructure/backend";
import { makeStore } from "../make-store";
import { settings } from "../settings/settings";

// Buddy pipelines in the main window: a vault project's linked Buddy project (settings.buddy) shows a button in its
// title bar, its dot the worst status of the pipelines, its menu each pipeline with its last run. Read-only: every
// call is a GET the backend allowlists (packages/integration-buddy).

type BuddyState = {
  pipes: Record<string, { list: Pipe[] | null; err: string; at: number }>; // per vault project
  runs: Record<string, Run | null>; // per "<vault project>#<pipeline id>"
};
export const useBuddyStore = makeStore<BuddyState>(() => ({ pipes: {}, runs: {} }));
const set = useBuddyStore.setState;

const get = (path: string) => backend.integrationCall("buddy", "GET", path, null);
const base = (ref: BuddyRef) =>
  `/workspaces/${encodeURIComponent(ref.workspace)}/projects/${encodeURIComponent(ref.project)}/pipelines`;

/** The Buddy project linked to a vault project, while Buddy is switched on. */
export const buddyOf = (project: string): BuddyRef | null => {
  const s = settings();
  return s.integrations?.buddy?.on === true ? (s.buddy?.[project] ?? null) : null;
};

// ponytail: refreshed when the title bar shows or the menu opens, at most once a minute; no background polling
const FRESH = 60_000;
/** The project's pipelines and their status, unless they arrived less than a minute ago. */
export async function loadPipes(project: string, force = false) {
  const ref = buddyOf(project);
  const had = useBuddyStore.getState().pipes[project];
  if (!ref || (!force && had && Date.now() - had.at < FRESH)) return;
  set(draft => {
    draft.pipes[project] = { list: had?.list ?? null, err: "", at: Date.now() };
  });
  try {
    const list = pipesOf(await get(`${base(ref)}?per_page=100`));
    set(draft => {
      draft.pipes[project] = { list, err: "", at: Date.now() };
    });
  } catch (error) {
    set(draft => {
      draft.pipes[project] = { list: had?.list ?? null, err: String(error), at: Date.now() };
    });
  }
}
/** The last run of each enabled pipeline, for the menu: one small call per pipeline. */
export async function loadRuns(project: string) {
  const ref = buddyOf(project);
  const list = useBuddyStore.getState().pipes[project]?.list;
  if (!ref || !list) return;
  await Promise.all(
    list
      .filter(pipe => !pipe.disabled)
      .map(async pipe => {
        const run = await get(`${base(ref)}/${pipe.id}/executions?per_page=1`).then(lastRunOf, () => null);
        set(draft => {
          draft.runs[`${project}#${pipe.id}`] = run;
        });
      }),
  );
}
/** A pipeline or run page in the browser; only Buddy's own pages (domain/buddy keeps the rest out). */
export const openInBuddy = (url: string) => url && backend.openUrl(url);
