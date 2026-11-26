import { pauseAllPipelines, pausePipeline, pipelinePanel } from "../../../application/pipeline/runner";
import { openProjectBoard } from "../../../application/navigation/navigation";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";
import { PipeReset } from "./PipeReset";

/** A pipeline's controls on the right of its stage strip's bar: how many agents run of how many it may, its state as
 *  a pill that pauses or resumes it, the link to its board and Start over. No pill or count for a pipeline that is off:
 *  Settings › Projects switches it on. */
export function PipeControls({ project }: { project: string }) {
  const { t } = useT();
  const panel = useDerived(() => pipelinePanel(project));
  return (
    <span className="flex-none flex items-center gap-1.5">
      {panel.on ? (
        <>
          <span className="mr-1 text-xs text-secondary whitespace-nowrap">
            {t("ps.agents", { n: panel.running, max: panel.parallel })}
          </span>
          <PipeState project={project} />
          <span className="w-px h-4.5 mx-1 bg-separator-strong" />
        </>
      ) : null}
      <PipeBoard project={project} />
      <PipeReset project={project} />
    </span>
  );
}

/** The pipeline's state (running, paused, or holding and why) as a pill that is also its pause button: hovered it
 *  says what a click does. Paused with every pipeline, a click resumes them all, as only that makes it go on. */
function PipeState({ project }: { project: string }) {
  const { t } = useT();
  const panel = useDerived(() => pipelinePanel(project));
  const hold = panel.holding === "pl.usedUp" ? "ps.holdUsed" : "ps.holdStalled";
  const paused = panel.paused || panel.all;
  const [label, style, mark] = paused
    ? [
        t(panel.all ? "pp.pausedAll" : "pp.paused"),
        "bg-fill-2 text-label",
        <Icon key="m" name="pause" className="glyph size-2.5 fill-current" />,
      ]
    : panel.holding
      ? [t(hold), "bg-soon/15 text-soon", <Icon key="m" name="alert" className="glyph size-3" />]
      : [t("pp.running"), "bg-accent-soft text-accent-text", <span key="m" className="spinner" />];
  const [action, go] = panel.all
    ? [t("pp.resumeAll"), () => pauseAllPipelines(false)]
    : paused
      ? [t("pp.resume"), () => pausePipeline(project, false)]
      : [t("pp.pause"), () => pausePipeline(project, true)];
  // both labels in one cell, the hovered one shown: the pill keeps the width of the longer
  const face = "col-start-1 row-start-1 flex items-center gap-1.5";
  return (
    <button
      className={`group flex-none h-5.5 grid pl-1.75 pr-2.25 rounded-full text-xs font-medium whitespace-nowrap cursor-default hover:bg-fill-2 hover:text-label ${style}`}
      title={`${label} · ${action}`}
      aria-label={`${label}. ${action}`}
      onClick={() => void go()}
    >
      <span className={`${face} group-hover:invisible`}>
        {mark}
        {label}
      </span>
      <span className={`${face} invisible group-hover:visible`}>
        <Icon name={paused ? "play" : "pause"} className="glyph size-2.5 fill-current" />
        {action}
      </span>
    </button>
  );
}

/** The link to the pipeline's board: the column it picks from. */
function PipeBoard({ project }: { project: string }) {
  const { t } = useT();
  const name = useDerived(() => pipelinePanel(project).pickName);
  return (
    <button
      className="h-7 flex items-center gap-1.5 px-2 rounded-lg text-xs text-secondary whitespace-nowrap hover:bg-fill-2 hover:text-label cursor-default"
      title={t("ps.board")}
      onClick={() => void openProjectBoard(project)}
    >
      <Icon name="kanban" className="glyph size-3.5" />
      {name || t("ps.board")}
      <Icon name="out" className="glyph size-3" />
    </button>
  );
}
