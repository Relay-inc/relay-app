import type { Key } from "../../../shared/i18n";
import type { CardView, TicketFlow } from "../../../domain/board/types";
import { useT } from "../../hooks/useT";

const CHIP = "h-4.5 px-1.5 rounded-[5px] bg-fill-2 inline-flex items-center whitespace-nowrap";
const VERDICT: Record<TicketFlow["verdict"], Key> = {
  ready: "kb.flowReady",
  "not-ready": "kb.flowNotReady",
  split: "kb.flowSplit",
};
const hours = (minutes: number) => `${Math.round((minutes / 60) * 10) / 10} h`;

/** The lead's grooming verdict as chips: "Ready · M", a marker for high risk, "Built" once the ticket was built. */
export function FlowChips({ flow }: { flow?: TicketFlow }) {
  const { t } = useT();
  if (!flow) return null;
  return (
    <>
      <span className={CHIP} title={[flow.size, flow.hours].filter(Boolean).join(" ")}>
        {t(VERDICT[flow.verdict])}
        {flow.size ? ` · ${flow.size}` : ""}
      </span>
      {flow.risk === "high" && <span className={`${CHIP} text-late`}>{t("kb.flowRisk")}</span>}
      {flow.built && <span className={`${CHIP} text-ok`}>{t("kb.flowBuilt")}</span>}
    </>
  );
}

/** The ticket window's grooming line: the chips, the size's hours and the budget the lead wrote, then the task's
 *  estimate against the time worked on it. Nothing when there is neither. */
export function TicketFlowLine({ flow, time }: { flow?: CardView["flow"]; time?: CardView["time"] }) {
  const { t } = useT();
  const { estimate, worked } = time ?? {};
  const over = estimate && worked && worked > estimate ? worked - estimate : 0;
  if (!flow && !estimate && !worked) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-secondary tabular-nums">
      <FlowChips flow={flow} />
      {flow?.hours && <span>{flow.hours}</span>}
      {flow?.budget && <span>{t("kb.flowBudget", { text: flow.budget })}</span>}
      {(estimate || worked) && (
        <span>
          {t("kb.fEstimate")} {estimate ? hours(estimate) : "-"} · {t("kb.fWorked")} {hours(worked ?? 0)}
        </span>
      )}
      {!!over && <span className="font-medium text-late">{t("kb.flowOver", { h: hours(over) })}</span>}
    </div>
  );
}
