import { useEffect, useMemo } from "react";
import type { PR } from "../../../domain/pull-requests/types";
import { usePullRequestsStore } from "../../../application/pull-requests/store";
import { useNavigationStore } from "../../../application/navigation/store";
import { openPr } from "../../../application/navigation/panel";
import { prKey } from "../../../domain/navigation/keys";
import { useT } from "../../hooks/useT";
import { PrRow } from "./PrRow";
import { PrPane } from "./PrPane";
import { ColumnResize } from "../navigation/ColumnResize";
import { useLinksStore } from "../../../application/today/links";
import { byTicket } from "../../../domain/pull-requests/group";
import { groupTitle } from "../../../domain/today/kinds/pr";
import { reviewTogether } from "../../../application/today/review";

/** The Pull requests view, as Mail does it: the list on the left (what waits for your review, what you opened), the
 *  PR you picked on the right, so you can go from one to the next without closing anything. Reloading is the title
 *  bar's button. */
export function PullRequestsView({ className = "" }: { className?: string }) {
  const { t } = useT();
  const all = usePullRequestsStore(s => s.list);
  const err = usePullRequestsStore(s => s.err);
  const busy = usePullRequestsStore(s => s.busy);
  const open = useNavigationStore(s => s.panel.prOpen);
  const tickets = useLinksStore(s => s.links);
  // opened from a project's title bar: only that project's PRs
  const project = useNavigationStore(s => s.tool?.project);
  const list = useMemo(
    () =>
      all && project
        ? {
            ...all,
            review: all.review.filter(pr => pr.project === project),
            mine: all.mine.filter(pr => pr.project === project),
          }
        : all,
    [all, project],
  );

  // with nothing picked yet (or a PR of another project), the first PR of the list
  const first = list?.review[0] || list?.mine[0];
  const firstKey = first ? prKey(first.repo, first.number) : "";
  const shown = !!list && [...list.review, ...list.mine].some(pr => prKey(pr.repo, pr.number) === open);
  useEffect(() => {
    if (!shown && firstKey) openPr(firstKey);
  }, [shown, firstKey]);

  const group = (name: string, prs: PR[], mine: boolean) => (
    <section>
      <h2 className="flex items-baseline gap-1.5 px-4 pt-4.5 pb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-tertiary">
        {name} <span className="tabular-nums">{prs.length}</span>
      </h2>
      <div className="flex flex-col gap-0.5 px-2">
        {prs.length ? (
          // the PRs of one ticket together under it, as Today's queue groups them
          byTicket(prs, tickets).map(each => {
            const { key, ticket, prs: group } = each;
            const rows = group.map(pr => {
              const key = prKey(pr.repo, pr.number);
              return <PrRow key={key} pr={pr} mine={mine} selected={open === key} onOpen={() => openPr(key)} />;
            });
            const title = groupTitle(each, t);
            return ticket ? (
              <div key={key} className="flex flex-col gap-0.5 pt-2">
                <div className="flex items-baseline gap-2 px-2.5 text-xs text-secondary">
                  <span className="min-w-0 flex-1 truncate">{title}</span>
                  {mine ? null : (
                    <button
                      type="button"
                      className="flex-none font-medium text-accent hover:underline cursor-pointer"
                      title={t("today.reviewTogetherTip", { ticket: title })}
                      onClick={() => reviewTogether(each)}
                    >
                      {t("today.reviewTogether", { n: group.length })}
                    </button>
                  )}
                </div>
                <div className="flex flex-col gap-0.5 ml-2.5 pl-1 border-l border-separator">{rows}</div>
              </div>
            ) : (
              rows
            );
          })
        ) : (
          <div className="text-secondary text-sm px-2.5 py-2">{t("pr.none")}</div>
        )}
      </div>
    </section>
  );
  let lists = null;
  if (list)
    lists = (
      <>
        {group(t("nav.prsReview"), list.review, false)}
        {group(t("pr.mine"), list.mine, true)}
      </>
    );
  else if (!busy) lists = <div className="text-secondary text-sm text-center p-4">{t("pr.notLoaded")}</div>;
  return (
    <div className={`${className} relative grid grid-cols-[var(--prs-w)_minmax(0,1fr)] min-h-0`}>
      <ColumnResize column="prs" />
      <div className="min-h-0 overflow-y-auto border-r border-separator pb-4">
        {err ? <div className="err-box m-4">{err}</div> : null}
        {lists}
      </div>
      <div className="min-h-0 overflow-y-auto">{open && (shown || !project) ? <PrPane prKey={open} /> : null}</div>
    </div>
  );
}
