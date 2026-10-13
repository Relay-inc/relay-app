import { ORCH } from "../../../domain/orchestrator/rules";
import { typeInto } from "../../../application/conversations/actions";
import { request } from "../../../application/navigation/requests";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";
import { Crab } from "./Crab";

const STARTERS = ["orch.starter1", "orch.starter2", "orch.starter3"] as const;

/** The orchestrator before its first task: what it does, and a few tasks to start from (one goes into the composer). */
export function OrchestratorEmpty() {
  const { t } = useT();
  return (
    <div className="flex flex-col items-center gap-4 pt-[12vh] px-15 text-center">
      <Crab costume="plain" running size={56} />
      <h2 className="text-xl font-semibold">{t("orch.emptyTitle")}</h2>
      <p className="max-w-105 text-sm leading-relaxed text-secondary">{t("orch.emptyText")}</p>
      <div className="flex flex-col gap-1.5 mt-2 w-full max-w-110">
        {STARTERS.map(key => (
          <button
            key={key}
            className="flex items-center gap-2.5 min-h-10 px-3.5 rounded-[10px] border border-separator-strong bg-transparent text-[13px] text-label text-left cursor-default hover:bg-fill"
            onClick={() => {
              typeInto(ORCH, t(key));
              request("focus-composer");
            }}
          >
            <span className="flex-1">{t(key)}</span>
            <Icon name="out" className="glyph size-3.25 text-tertiary" />
          </button>
        ))}
      </div>
    </div>
  );
}
