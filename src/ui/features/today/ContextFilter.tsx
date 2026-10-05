import type { TodayModel } from "../../../application/today/today";
import { setContext } from "../../../application/today/store";
import { contextTint } from "../../../application/navigation/sidebar";
import { NO_PROJECT } from "../../../domain/today/plan";
import { useT } from "../../hooks/useT";

// literal classes, so Tailwind finds them
const DOT = { "ctx-a": "bg-ctx-a", "ctx-m": "bg-ctx-m", "ctx-p": "bg-ctx-p" } as const;

/** Today per context: all of it, one context of the vault (Antenna, Freelance, Personal), or what has no project.
 *  A context with nothing today stays out, unless it is the one picked. */
export function ContextFilter({ model }: { model: TodayModel }) {
  const { t } = useT();
  const chips = model.contexts.filter(c => !c.id || c.n || c.id === model.context);
  return (
    <div className="flex items-center gap-0.5 bg-fill-2 rounded-lg p-0.5">
      {chips.map(chip => {
        const on = chip.id === model.context;
        const tint = chip.id && chip.id !== NO_PROJECT ? contextTint(chip.id) : "";
        return (
          <button
            key={chip.id || "all"}
            onClick={() => setContext(chip.id)}
            className={`inline-flex items-center gap-1.5 h-6 px-2 rounded-md text-xs font-medium whitespace-nowrap cursor-pointer ${on ? "bg-raised shadow-sm text-label" : "text-secondary hover:text-label"}`}
          >
            {tint ? <span className={`size-1.75 rounded-full ${DOT[tint]}`} /> : null}
            {chip.id === "" ? t("today.ctxAll") : chip.id === NO_PROJECT ? t("today.ctxNone") : chip.id}
            <span className="text-tertiary tabular-nums">{chip.n}</span>
          </button>
        );
      })}
    </div>
  );
}
