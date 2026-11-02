// Buddy pipelines per vault project (application/buddy): what the API answers, read into what the title bar shows.

/** The Buddy project linked to a vault project: its workspace domain and project name, as they go in API paths. */
export type BuddyRef = { workspace: string; project: string };
/** How a run went, in four tones: ok, failed, running (or waiting), and none (never ran, skipped, stopped). */
export type Tone = "ok" | "fail" | "busy" | "none";
/** A pipeline of the linked project: `url` is its page in Buddy. */
export type Pipe = { id: number; name: string; url: string; tone: Tone; disabled: boolean };
/** A pipeline's last run: when it started and finished (ISO, "" while running), on which branch, by whom, its page. */
export type Run = { started: string; finished: string; branch: string; by: string; url: string };

const BUSY = ["INPROGRESS", "ENQUEUED", "INITIAL", "TERMINATING"];
/** An execution status (`last_execution_status`, `status`) as a tone; Buddy's WAITING_FOR_* count as busy. */
export const toneOf = (status: unknown): Tone =>
  status === "SUCCESSFUL"
    ? "ok"
    : status === "FAILED"
      ? "fail"
      : typeof status === "string" && (BUSY.includes(status) || status.startsWith("WAITING_FOR_"))
        ? "busy"
        : "none";

type Json = Record<string, unknown>;
const list = (v: unknown, key: string) => ((v as Json | null)?.[key] as Json[] | undefined) ?? [];
const text = (v: unknown) => (typeof v === "string" ? v : "");
/** Only a link to Buddy's own pages opens in the browser. */
const page = (v: unknown) => (/^https:\/\/([a-z]+\.)?buddy\.works\//.test(text(v)) ? text(v) : "");

/** GET /workspaces/:w/projects/:p/pipelines → the pipelines, in Buddy's order. */
export const pipesOf = (answer: unknown): Pipe[] =>
  list(answer, "pipelines").map(p => ({
    id: Number(p.id),
    name: text(p.name),
    url: page(p.html_url),
    tone: toneOf(p.last_execution_status),
    disabled: p.disabled === true,
  }));
/** GET …/pipelines/:id/executions?per_page=1 → the last run, or null when it never ran. */
export const lastRunOf = (answer: unknown): Run | null => {
  const run = list(answer, "executions")[0];
  if (!run) return null;
  return {
    started: text(run.start_date),
    finished: text(run.finish_date),
    branch: text((run.branch as Json | undefined)?.name),
    by: text((run.creator as Json | undefined)?.name),
    url: page(run.html_url),
  };
};
/** GET /workspaces, then /workspaces/:w/projects per workspace → every project as an option "workspace/project". */
export const projectsOf = (workspace: string, answer: unknown) =>
  list(answer, "projects").map(p => ({
    id: `${workspace}/${text(p.name)}`,
    name: `${text(p.display_name) || text(p.name)} · ${workspace}`,
  }));
export const workspacesOf = (answer: unknown) =>
  list(answer, "workspaces")
    .map(w => text(w.domain))
    .filter(Boolean);
/** The project's tone: failed wins, then running, then ok; disabled pipelines do not count. */
export const worst = (pipes: Pipe[]): Tone => {
  const tones = pipes.filter(p => !p.disabled).map(p => p.tone);
  return (["fail", "busy", "ok"] as const).find(t => tones.includes(t)) ?? "none";
};
/** "workspace/project" from the settings' project picker, back into a ref; null for anything else. */
export const refOf = (value: string): BuddyRef | null => {
  const [workspace, project, rest] = value.split("/");
  const slug = /^[A-Za-z0-9_-]{1,100}$/;
  return rest === undefined && slug.test(workspace ?? "") && slug.test(project ?? "") ? { workspace, project } : null;
};
