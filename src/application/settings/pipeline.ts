import type { Column } from "../../domain/board/types";
import { EMPTY_PIPELINE } from "../../domain/pipeline/rules";
import type { Pipeline } from "../../domain/pipeline/types";
import * as backend from "../../infrastructure/backend";
import { provider as providerOf } from "../../shared/plugins";
import { ctxOf } from "../board/ctx";
import { useSettingsStore } from "./store";
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

/** The checkout, picked in a folder dialog. */
export async function pickPipelineRepo(project: string) {
  const folder = await backend.pickFolder();
  if (folder) await setPipeline(project, { repo: folder });
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
