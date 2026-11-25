import { useState } from "react";
import { resetPipeline } from "../../../application/pipeline/runner";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";

/** The reset button of a pipeline's conversation, in its title bar: asks in place first, then a fresh conversation
 *  starts with the pipeline as it is now. The pipeline runs on. */
export function PipeReset({ project }: { project: string }) {
  const { t } = useT();
  const [asking, setAsking] = useState(false);
  if (!asking)
    return (
      <button className="btn-icon" title={t("po.resetHelp")} aria-label={t("po.reset")} onClick={() => setAsking(true)}>
        <Icon name="refresh" className="glyph size-4" />
      </button>
    );
  return (
    <span className="flex items-center gap-2 text-[13px] text-secondary">
      <span className="max-w-64 truncate" title={t("po.resetHelp")}>
        {t("po.resetHelp")}
      </span>
      <button
        className="h-7 px-2.5 rounded-lg border-0 bg-accent text-on-accent font-medium cursor-default"
        onClick={() => {
          setAsking(false);
          void resetPipeline(project);
        }}
      >
        {t("po.resetYes")}
      </button>
      <button
        className="h-7 px-2.5 rounded-lg border-0 bg-transparent text-secondary hover:bg-fill-2 cursor-default"
        onClick={() => setAsking(false)}
      >
        {t("pp.cancel")}
      </button>
    </span>
  );
}
