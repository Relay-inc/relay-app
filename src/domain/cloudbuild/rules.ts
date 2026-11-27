import type { Tone } from "../buddy/rules";

// Google Cloud Build per vault project (application/cloudbuild): what the API answers, read into what the title bar shows.

/** The GCP project linked to a vault project, with the location its builds run in (`global` or a region). */
export type CloudRef = { project: string; location: string };
/** A trigger's last build: when it started and finished (ISO, "" while running), the branch, the short commit, its log. */
export type Run = { started: string; finished: string; branch: string; commit: string; url: string };
/** A trigger and its last build; `id` is "" for the builds that came from no trigger (shown as "Manual"). */
export type Trigger = { id: string; name: string; tone: Tone; run: Run };

/** A build status as a tone: QUEUED, PENDING and WORKING are busy; CANCELLED, EXPIRED and the rest are none. */
export const toneOf = (status: unknown): Tone =>
  status === "SUCCESS"
    ? "ok"
    : status === "FAILURE" || status === "INTERNAL_ERROR" || status === "TIMEOUT"
      ? "fail"
      : status === "QUEUED" || status === "PENDING" || status === "WORKING"
        ? "busy"
        : "none";

type Json = Record<string, unknown>;
const text = (v: unknown) => (typeof v === "string" ? v : "");
/** Only a link into the Google Cloud console opens in the browser. */
const page = (v: unknown) => (/^https:\/\/console\.cloud\.google\.com\//.test(text(v)) ? text(v) : "");

/** GET …/builds?pageSize=50 → one entry per trigger with its newest build, the newest trigger first. The API sorts by
 *  createTime, newest first, but the order is not relied on. */
export const triggersOf = (answer: unknown): Trigger[] => {
  const builds = (((answer as Json | null)?.builds as Json[] | undefined) ?? [])
    .slice()
    .sort((a, b) => text(b.createTime).localeCompare(text(a.createTime)));
  const seen = new Map<string, Trigger>();
  for (const build of builds) {
    const id = text(build.buildTriggerId);
    if (seen.has(id)) continue;
    const subs = (build.substitutions as Json | undefined) ?? {};
    seen.set(id, {
      id,
      name: text(subs.TRIGGER_NAME) || id,
      tone: toneOf(build.status),
      run: {
        started: text(build.startTime) || text(build.createTime),
        finished: text(build.finishTime),
        branch: text(subs.BRANCH_NAME),
        commit: text(subs.SHORT_SHA),
        url: page(build.logUrl),
      },
    });
  }
  return [...seen.values()];
};
/** GET /v1/projects → the active projects as picker options, id and name. */
export const projectsOf = (answer: unknown) =>
  (((answer as Json | null)?.projects as Json[] | undefined) ?? [])
    .filter(p => p.lifecycleState === undefined || p.lifecycleState === "ACTIVE")
    .map(p => ({ id: text(p.projectId), name: `${text(p.name) || text(p.projectId)} · ${text(p.projectId)}` }))
    .filter(p => p.id)
    .sort((a, b) => a.name.localeCompare(b.name));
/** The project's tone: failed wins, then running, then ok. */
export const worst = (triggers: Trigger[]): Tone =>
  (["fail", "busy", "ok"] as const).find(tone => triggers.some(x => x.tone === tone)) ?? "none";
/** A project id and location as typed in the settings, as a ref; null for anything the backend would refuse. */
export const refOf = (project: string, location: string): CloudRef | null => {
  const place = location.trim() || "global";
  return /^[a-z][a-z0-9-]{5,29}$/.test(project) && (place === "global" || /^[a-z][a-z0-9-]{3,29}$/.test(place))
    ? { project, location: place }
    : null;
};
