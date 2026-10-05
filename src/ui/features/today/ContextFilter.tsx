import type { TodayModel } from "../../../application/today/today";
import { setContext } from "../../../application/today/store";
import { NO_PROJECT } from "../../../domain/today/plan";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";

/** Today per context: all of it, one context of the vault (Antenna, Freelance, Personal), or what has no project.
 *  A quiet select in the header; a context with nothing today stays out, unless it is the one picked. */
export function ContextFilter({ model }: { model: TodayModel }) {
  const { t } = useT();
  const options = model.contexts.filter(c => !c.id || c.n || c.id === model.context);
  const name = (id: string) => (id === "" ? t("today.allProjects") : id === NO_PROJECT ? t("today.ctxNone") : id);
  return (
    <label className="relative inline-flex items-center gap-1 h-7 pl-2 pr-1.5 rounded-md text-[13px] text-secondary cursor-pointer hover:bg-fill hover:text-label">
      <span className="whitespace-nowrap">{name(model.context)}</span>
      <Icon name="chevron" className="glyph size-3" />
      <select
        aria-label={t("today.allProjects")}
        value={model.context}
        onChange={e => setContext(e.target.value)}
        className="absolute inset-0 opacity-0 cursor-pointer"
      >
        {options.map(option => (
          <option key={option.id || "all"} value={option.id}>
            {name(option.id)} ({option.n})
          </option>
        ))}
      </select>
    </label>
  );
}
