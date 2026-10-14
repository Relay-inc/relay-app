import type { Worker } from "../../../domain/orchestrator/types";
import { needOf, workerName } from "../../../domain/orchestrator/rules";
import { WorkerAvatar, useStateText } from "./parts";

/** One worker in the orchestrator's column: its crab, title, name, project and state, the accent dot while it waits on
 *  you. The row opens the worker's page. */
export function WorkerRow({
  worker,
  project,
  selected,
  onOpen,
}: {
  worker: Worker;
  project: string; // the project's label as the sidebar shows it, or Algemeen
  selected: boolean;
  onOpen: () => void;
}) {
  const state = useStateText(worker);
  const need = !!needOf(worker);
  return (
    <button
      className={`flex w-full items-center gap-3 min-h-13 px-2.5 rounded-[10px] border-0 text-left cursor-default ${selected ? "bg-accent-soft" : "bg-transparent hover:bg-fill"}`}
      title={worker.task}
      onClick={onOpen}
    >
      <span className="flex self-center">
        <WorkerAvatar worker={worker} />
      </span>
      <span className="flex-1 min-w-0 flex flex-col leading-snug">
        <span className={`text-sm truncate ${selected || need ? "font-semibold" : "font-medium"}`}>{worker.title}</span>
        <span className="text-xs text-secondary truncate">
          {workerName(worker.key)} · {project} · <span className={state.color}>{state.short}</span>
        </span>
      </span>
      {need ? <span className="size-2 flex-none rounded-full bg-accent" /> : null}
    </button>
  );
}
