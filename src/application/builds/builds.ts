import type { Tone } from "../../domain/buddy/rules";
import type { Attention } from "../../domain/navigation/views";
import { buddyOf, loadPipes, loadRuns, useBuddyStore } from "../buddy/buddy";
import { cloudOf, loadBuilds, useCloudStore } from "../cloudbuild/cloudbuild";
import { makeStore } from "../make-store";

// The Builds tab of the project panel: Buddy's pipelines and Cloud Build's triggers of a project as one list, and what
// the title bar says about them: a build that runs, a failed one until the tab has been opened.

/** One pipeline or trigger with its last run; `at` is ISO, "" while it runs or when it never ran. */
export type Build = {
  key: string;
  source: "buddy" | "cloudbuild";
  name: string;
  tone: Tone;
  at: string;
  branch: string;
  by: string; // who started it (Buddy) or the short commit (Cloud Build)
  url: string;
};

/** Per project, the failed builds the Builds tab showed when it was last open: those no longer call for attention. */
const useSeenStore = makeStore<{ failed: Record<string, string> }>(() => ({ failed: {} }));

const RANK: Record<Tone, number> = { fail: 0, busy: 1, none: 2, ok: 3 };

/** The project's pipelines and triggers, failed first, then running. Empty while neither is linked or loaded. */
export function buildsOf(project: string): Build[] {
  const pipes = buddyOf(project) ? (useBuddyStore.getState().pipes[project]?.list ?? []) : [];
  const runs = useBuddyStore.getState().runs;
  const triggers = cloudOf(project) ? (useCloudStore.getState().builds[project]?.list ?? []) : [];
  return [
    ...pipes
      .filter(pipe => !pipe.disabled)
      .map((pipe): Build => {
        const run = runs[`${project}#${pipe.id}`];
        return {
          key: `buddy#${pipe.id}`,
          source: "buddy",
          name: pipe.name,
          tone: pipe.tone,
          at: run ? run.finished || run.started : "",
          branch: run?.branch ?? "",
          by: run?.by ?? "",
          url: pipe.url,
        };
      }),
    ...triggers.map((trigger): Build => ({
      key: `cloudbuild#${trigger.id}`,
      source: "cloudbuild",
      name: trigger.name,
      tone: trigger.tone,
      at: trigger.run.finished || trigger.run.started,
      branch: trigger.run.branch,
      by: trigger.run.commit,
      url: trigger.run.url,
    })),
  ].sort((a, b) => RANK[a.tone] - RANK[b.tone]);
}

const failedKey = (project: string) =>
  buildsOf(project)
    .filter(build => build.tone === "fail")
    .map(build => build.key)
    .join();

/** What the Builds tab says: a failed build until the tab was opened with it, else a running one. */
export function buildsAttention(project: string): Attention {
  const failed = failedKey(project);
  if (failed && failed !== useSeenStore.getState().failed[project]) return "fail";
  return buildsOf(project).some(build => build.tone === "busy") ? "busy" : null;
}

/** The Builds tab shows the failed builds: they stop calling for attention. */
export const markBuildsSeen = (project: string) => {
  const failed = failedKey(project);
  if (useSeenStore.getState().failed[project] !== failed)
    useSeenStore.setState(draft => {
      draft.failed[project] = failed;
    });
};

/** The project's pipelines and triggers read (again, with `force`, which also reads each pipeline's last run); once none has failed, the next failure is news again. */
export async function readBuilds(project: string, force = false) {
  await Promise.all([
    loadPipes(project, force).then(() => (force ? loadRuns(project) : undefined)),
    loadBuilds(project, force),
  ]);
  if (!failedKey(project) && useSeenStore.getState().failed[project])
    useSeenStore.setState(draft => {
      delete draft.failed[project];
    });
}

// ponytail: an idle project is read when its title bar shows; only a running build is read again, every minute
const POLL = 60_000;
/** Read the project's builds, and again every minute while one runs. Returns what stops it. */
export function watchBuilds(project: string) {
  void readBuilds(project);
  const timer = setInterval(() => {
    if (buildsOf(project).some(build => build.tone === "busy")) void readBuilds(project, true);
  }, POLL);
  return () => clearInterval(timer);
}
