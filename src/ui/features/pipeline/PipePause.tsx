import { ready } from "../../../domain/pipeline/rules";
import { pauseAllPipelines, pausePipeline } from "../../../application/pipeline/runner";
import { settings } from "../../../application/settings/settings";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";

/** Pause and resume of a pipeline, in its conversation's title bar: its tooltip says whether it runs, is paused or
 *  is paused with every pipeline. Paused with every pipeline, a click resumes them all, as only that makes it go on.
 *  A pipeline that is off has nothing to pause: Settings › Projects switches it on. */
export function PipePause({ project }: { project: string }) {
  const { t } = useT();
  const { on, paused, all } = useDerived(() => {
    const s = settings();
    const p = s.pipelines?.[project];
    return { on: ready(p), paused: !!p?.paused, all: !!s.pipelinesPaused };
  });
  if (!on) return null;
  const [state, action, go] = all
    ? [t("pp.pausedAll"), t("pp.resumeAll"), () => pauseAllPipelines(false)]
    : paused
      ? [t("pp.paused"), t("pp.resume"), () => pausePipeline(project, false)]
      : [t("pp.running"), t("pp.pause"), () => pausePipeline(project, true)];
  return (
    <button
      className="h-7 flex items-center gap-1.5 px-3 rounded-lg border border-separator-strong bg-transparent text-[13px] font-medium whitespace-nowrap hover:bg-fill-2 cursor-default"
      title={`${state} · ${action}`}
      onClick={() => void go()}
    >
      <Icon name={paused || all ? "play" : "pause"} className="glyph size-2.5 fill-current" />
      {action}
    </button>
  );
}
