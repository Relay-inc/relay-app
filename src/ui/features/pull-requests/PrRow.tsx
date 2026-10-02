import type { PR } from "../../../domain/pull-requests/types";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";
import { CI, CI_TEXT, age, prColor } from "./prState";

const REVIEW: Record<string, [string, "rv.changes" | "rv.approved"]> = {
  CHANGES_REQUESTED: ["text-late", "rv.changes"],
  APPROVED: ["text-ok", "rv.approved"],
};

/** One PR row: in the Pull requests view (title, meta, CI and review status) and, `compact`, in the panel's PR tab.
 *  `mine` leaves the author out. */
export function PrRow({
  pr,
  mine = false,
  selected = false,
  compact = false,
  onOpen,
}: {
  pr: PR;
  mine?: boolean;
  selected?: boolean;
  compact?: boolean;
  onOpen: () => void;
}) {
  const { t } = useT();
  const ci = pr.ci ? CI[pr.ci] : undefined;
  const repo = pr.repo.split("/")[1] || pr.repo;
  const ciLabel = (gap: string) =>
    ci ? (
      <span className={`inline-flex items-center ${gap} ${CI_TEXT[ci[0]]}`}>
        <span className="size-1.5 rounded-full bg-current"></span>
        {t(ci[1])}
      </span>
    ) : null;
  const glyph = (
    <span className={`mt-px size-4 flex-none ${prColor(pr)}`}>
      <Icon name="pr" />
    </span>
  );

  // the panel's row: a state-coloured PR glyph, the title, then "#number repo, CI dot and label". A button does not
  // stretch like a div: the selected row's negative margins need the width spelled out
  if (compact)
    return (
      <button
        type="button"
        className={`group flex gap-2.5 py-2.5 border-b border-separator cursor-default text-left ${selected ? "bg-fill -mx-2.5 px-2.5 rounded-lg w-[calc(100%+1.25rem)]" : "w-full"}`}
        onClick={onOpen}
      >
        {glyph}
        <div className="min-w-0 flex-1 flex flex-col gap-0.75">
          <span className="text-[13px] font-medium leading-snug line-clamp-2 group-hover:text-accent">
            {pr.draft ? <span className="text-xs font-normal text-secondary mr-1.5">{t("pr.draft")}</span> : null}
            {pr.title}
          </span>
          <span className="text-xs text-secondary flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-mono text-[11px]">#{pr.number}</span>
            {repo}
            {ciLabel("gap-1")}
          </span>
        </div>
      </button>
    );

  const review = pr.review ? REVIEW[pr.review] : undefined;
  const byline = [mine ? "" : pr.author, age(pr.created, t)].filter(Boolean).join(" · ");
  return (
    <button
      type="button"
      className={`flex gap-2.5 p-2.5 rounded-[9px] cursor-pointer w-full text-left ${selected ? "bg-accent-soft" : "hover:bg-fill"}`}
      onClick={onOpen}
    >
      {glyph}
      <div className="min-w-0 flex-1 flex flex-col gap-1.25">
        <span className="text-[13px] font-medium leading-snug">
          {pr.draft ? (
            <span className="text-[11px] px-1.25 py-px rounded-sm mr-1.5 font-medium text-secondary border border-separator-strong">
              {t("pr.draft")}
            </span>
          ) : null}
          {pr.title}
        </span>
        <span className="flex flex-wrap items-center gap-2 text-xs text-secondary tabular-nums">
          <span className="font-mono text-[11px]">
            {repo}#{pr.number}
          </span>
          {byline}
        </span>
        <span className="flex flex-wrap gap-1.5 text-[11px] font-medium">
          {ciLabel("gap-1.25")}
          {review ? <span className={review[0]}>· {t(review[1])}</span> : null}
        </span>
      </div>
    </button>
  );
}
