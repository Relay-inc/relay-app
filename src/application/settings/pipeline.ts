import type { Column } from "../../domain/board/types";
import { EMPTY_PIPELINE } from "../../domain/pipeline/rules";
import type { Pipeline, PipelineRepo } from "../../domain/pipeline/types";
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

/** One repo of the project in the pipeline: switched off, or its checks. */
export function setPipelineRepo(project: string, slug: string, patch: { off?: boolean; checks?: string }) {
  const p = pipelineOf(project);
  return setPipeline(project, { repos: { ...p.repos, [slug]: { ...p.repos?.[slug], ...patch } } });
}

/** The checkouts on this Mac of the project's repos, with the one picked by hand. */
export const pipelineRepos = (project: string, extra: string): Promise<PipelineRepo[]> =>
  backend.pipelineRepos(project, extra);

/** A checkout picked by hand in a folder dialog: for a repo Relay finds none of, in place of the one it finds, or of a
 *  repo not listed under the project. One per project: a new pick replaces the last. */
export async function pickPipelineRepo(project: string) {
  const folder = await backend.pickFolder();
  if (!folder) return;
  await setPipeline(project, { repo: folder });
  await loadCheckouts(project);
}

/** Drops the checkout picked by hand. */
export async function clearPipelineRepo(project: string) {
  await setPipeline(project, { repo: "" });
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
