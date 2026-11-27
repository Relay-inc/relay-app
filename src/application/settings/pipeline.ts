import type { Column } from "../../domain/board/types";
import { EMPTY_PIPELINE, pickedOf } from "../../domain/pipeline/rules";
import type { Pipeline } from "../../domain/pipeline/types";
import * as backend from "../../infrastructure/backend";
import { provider as providerOf } from "../../shared/plugins";
import { ctxOf } from "../board/ctx";
import { useSettingsStore } from "./store";
import { loadCheckouts } from "./projects-page";
import { save } from "./window";

// A project's board pipeline in Settings › Projects (domain/pipeline). Saved on every change, like the other fields there.

export const pipelineOf = (project: string): Pipeline => ({
  ...EMPTY_PIPELINE,
  ...useSettingsStore.getState().settings.pipelines?.[project],
});

export function setPipeline(project: string, patch: Partial<Pipeline>) {
  const next = structuredClone(useSettingsStore.getState().settings);
  next.pipelines = { ...next.pipelines, [project]: { ...pipelineOf(project), ...patch } };
  return save(next);
}

/** Every project's pipeline going on or paused at once (Settings › Automation › Run pipelines, stored as the pause):
 *  each one's own pause stays as it was. */
export function setPipelinesRun(run: boolean) {
  return save({ ...useSettingsStore.getState().settings, pipelinesPaused: !run });
}

/** One repo of the project in the pipeline: switched off, or its checks. */
export function setPipelineRepo(project: string, slug: string, patch: { off?: boolean; checks?: string }) {
  const p = pipelineOf(project);
  return setPipeline(project, { repos: { ...p.repos, [slug]: { ...p.repos?.[slug], ...patch } } });
}

/** A checkout picked by hand in a folder dialog: for a repo Relay finds none of, in place of the one it finds, or of a
 *  repo not listed under the project. Added to the ones picked before; one it replaces for the same repo, or a folder
 *  that is no GitHub checkout, is dropped. */
export async function pickPipelineRepo(project: string) {
  const folder = await backend.pickFolder();
  if (!folder) return;
  const p = pipelineOf(project);
  const picked = [...pickedOf(p).filter(path => path !== folder), folder];
  const used = new Set((await backend.pipelineRepos(project, picked)).map(r => r.path));
  await keepPicked(
    project,
    p,
    picked.filter(path => used.has(path)),
  );
}

/** Drops one checkout picked by hand. */
export async function clearPipelineRepo(project: string, path: string) {
  const p = pipelineOf(project);
  await keepPicked(
    project,
    p,
    pickedOf(p).filter(other => other !== path),
  );
}

// `repo` stays while it is kept: its checks from before go by it (checksOf)
async function keepPicked(project: string, p: Pipeline, picked: string[]) {
  const repo = picked.includes(p.repo) ? p.repo : "";
  await setPipeline(project, { repo, checkouts: picked.filter(path => path !== repo) });
  await loadCheckouts(project);
}

/** The linked board's groupings and the columns of one, for the column pickers. */
export async function pipelineColumns(
  project: string,
  group: string,
): Promise<{ groupings: { id: string; label: string }[]; group: string; columns: Column[] }> {
  const s = useSettingsStore.getState().settings;
  const ref = s.boards?.[project];
  const prov = ref && providerOf(ref.provider);
  if (!ref || !prov) return { groupings: [], group: "", columns: [] };
  const groupings = prov.groupings ?? [];
  const g = group || groupings[0]?.id || "";
  const columns = await prov.columns(ctxOf(prov, s.integrations), ref, g);
  return { groupings: groupings.map(x => ({ id: x.id, label: `${prov.id}.${x.label}` })), group: g, columns };
}
