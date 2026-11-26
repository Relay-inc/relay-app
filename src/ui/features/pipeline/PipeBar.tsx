import { pipelinePanel } from "../../../application/pipeline/runner";
import { openProjectBoard } from "../../../application/navigation/navigation";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";

/** A pipeline conversation's state in its title bar, after the title: a pill (running, paused, or holding and why) and
 *  how many agents run of how many it may. Nothing for a pipeline that is off. */
export function PipeState({ project }: { project: string }) {
  const { t } = useT();
  const panel = useDerived(() => pipelinePanel(project));
  if (!panel.on) return null;
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
  return (
    <>
      <span
        className={`flex-none h-5.5 inline-flex items-center gap-1.5 pl-1.75 pr-2.25 rounded-full text-xs font-medium ${style}`}
      >
        {mark}
        {label}
      </span>
      <span className="flex-none text-xs text-secondary whitespace-nowrap">
        {t("ps.agents", { n: panel.running, max: panel.parallel })}
      </span>
    </>
  );
}

/** The link to the pipeline's board in the title bar: the column it picks from. */
export function PipeBoard({ project }: { project: string }) {
  const { t } = useT();
  const name = useDerived(() => pipelinePanel(project).pickName);
  return (
    <button
      className="h-7 flex items-center gap-1.5 px-2 rounded-lg text-[13px] text-secondary hover:bg-fill-2 hover:text-label cursor-default"
      title={t("ps.board")}
      onClick={() => void openProjectBoard(project)}
    >
      <Icon name="kanban" className="glyph size-3.5" />
      {name || t("ps.board")}
      <Icon name="out" className="glyph size-3" />
    </button>
  );
}
