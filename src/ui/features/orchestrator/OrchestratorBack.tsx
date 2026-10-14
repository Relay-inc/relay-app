import { ORCH } from "../../../domain/orchestrator/rules";
import { select } from "../../../application/navigation/navigation";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";

/** The title bar over a worker's page: back to the orchestrator's conversation (Esc does the same). */
export function OrchestratorBack() {
  const { t } = useT();
  return (
    <div className="flex-none h-12 flex items-center px-3 border-b border-separator select-none" data-tauri-drag-region>
      <button
        className="inline-flex items-center gap-1.5 h-7.5 pl-1.5 pr-2.5 rounded-lg border-0 bg-transparent text-[13px] font-medium text-secondary cursor-default hover:bg-fill-2 hover:text-label"
        onClick={() => select(ORCH)}
      >
        <Icon name="left" className="glyph size-3.75" />
        {t("orch.conversation")}
        <span className="px-1 rounded border border-separator-strong font-mono text-[11px] leading-4 text-tertiary">
          esc
        </span>
      </button>
    </div>
  );
}
