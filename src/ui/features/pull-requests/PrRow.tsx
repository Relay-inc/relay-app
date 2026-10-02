import type { PR } from "../../../domain/pull-requests/types";
import { useT } from "../../hooks/useT";
import { PrStatus } from "./PrStatus";

const MS_PER_DAY = 864e5;
const daysSince = (iso: string) => Math.floor((Date.now() - Date.parse(iso)) / MS_PER_DAY);

/** One PR row, in the list and (`compact`, chips under the title) in a project's PR tab. `project` is the project's
 *  display label, "" when the PR has none; `mine` leaves the author out. */
export function PrRow({
  pr,
  mine = false,
  selected = false,
  compact = false,
  project = "",
  onOpen,
}: {
  pr: PR;
  mine?: boolean;
  selected?: boolean;
  compact?: boolean;
  project?: string;
  onOpen: () => void;
}) {
  const { t } = useT();
  const days = daysSince(pr.created);
  const age = days < 1 ? t("due.today") : t("pr.days", { n: days });
  const layout = compact ? "grid grid-cols-1 gap-1 py-2" : "flex gap-4 py-2.5";
  // a button does not stretch like a div: the selected row's negative margins need the width spelled out
  const selectedClasses = selected ? "bg-fill -mx-2.5 px-2.5 rounded-lg w-[calc(100%+1.25rem)]" : "w-full";
  return (
    <button
      type="button"
      className={`group text-left items-center border-b border-separator text-inherit cursor-default ${layout} ${selectedClasses}`}
      onClick={onOpen}
    >
      <div className="min-w-0 flex-1">
        <div className={`group-hover:text-accent leading-snug line-clamp-2 ${compact ? "text-sm" : "text-base"}`}>
          {pr.draft ? (
            <span className="text-xs text-secondary border border-separator rounded-sm px-1 mr-1.5">
              {t("pr.draft")}
            </span>
          ) : null}
          {pr.title}
        </div>
        <div
          className={`flex flex-wrap gap-x-3 gap-y-1 text-secondary mt-0.5 tabular-nums ${compact ? "text-xs" : "text-sm"}`}
        >
          <span>
            {pr.repo.split("/")[1] || pr.repo} #{pr.number}
          </span>
          {project ? <span>{project}</span> : null}
          {mine ? null : <span>{pr.author || ""}</span>}
          <span>{age}</span>
        </div>
      </div>
      <PrStatus ci={pr.ci} review={pr.review} />
    </button>
  );
}
