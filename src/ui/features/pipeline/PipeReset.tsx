import { useState } from "react";
import { resetPipeline } from "../../../application/pipeline/runner";
import { useT } from "../../hooks/useT";

/** The reset button of a pipeline's conversation, in its title bar: asks in place first, then a fresh conversation
 *  starts with the pipeline as it is now. The pipeline runs on. */
export function PipeReset({ project }: { project: string }) {
  const { t } = useT();
  const [asking, setAsking] = useState(false);
  if (!asking)
    return (
      <button
        className="h-7 px-2.5 rounded-lg border-0 bg-transparent text-[13px] text-secondary whitespace-nowrap hover:bg-fill-2 hover:text-label cursor-default"
        title={t("po.resetHelp")}
        onClick={() => setAsking(true)}
      >
        {t("po.reset")}
      </button>
    );
  // the bar is narrow: the two buttons only, what Start over does is in their tooltip
  return (
    <span className="flex flex-none items-center gap-1.5 text-[13px]" title={t("po.resetHelp")}>
      <button
        className="h-7 px-2.5 rounded-lg border-0 bg-accent text-on-accent font-medium whitespace-nowrap cursor-default"
        onClick={() => {
          setAsking(false);
          void resetPipeline(project);
        }}
      >
        {t("po.resetYes")}
      </button>
      <button
        className="h-7 px-2.5 rounded-lg border-0 bg-transparent text-secondary whitespace-nowrap hover:bg-fill-2 cursor-default"
        onClick={() => setAsking(false)}
      >
        {t("pp.cancel")}
      </button>
    </span>
  );
}
