import { useEffect, useEffectEvent } from "react";
import { reviewOf } from "../../../domain/navigation/views";
import { reviewItemsOf } from "../../../application/today/today";
import { loadPr } from "../../../application/today/load";
import { closeReview, discardReview, openReview, useReviewStore } from "../../../application/today/review";
import { useNavigationStore } from "../../../application/navigation/store";
import { usePullRequestsStore } from "../../../application/pull-requests/store";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";
import { ReviewScreen } from "./ReviewScreen";

/** A review of Today's work in progress, as a view of its own (its row in the sidebar is the selection): the review
 *  screen on its PR, loaded when it opens (also after a restart or from the sidebar). When the PR no longer waits on
 *  the user it says so, with the way out: discard the review, or back to Today. Esc goes back to Today. */
export function ReviewView({ className = "" }: { className?: string }) {
  const { t } = useT();
  const id = useNavigationStore(s => reviewOf(s.selected));
  // the PRs it covers: one, or every PR of its ticket waiting on the user (a group)
  const items = useDerived(() => reviewItemsOf(id));
  const loaded = usePullRequestsStore(s => !!s.list);
  const confirm = useReviewStore(s => !!s.reviews[id]?.confirm);
  const prs = items.flatMap(item => (item.subject.type === "pr" ? (item.subject.prs ?? [item.subject.pr]) : []));
  const urls = prs.map(pr => pr.url).join(" ");
  const load = useEffectEvent(() => {
    if (!prs.length) return;
    openReview(id, prs, prs.length > 1 ? items[0].title : undefined);
    // each PR's detail under its own review id, where the review screen reads its threads and description
    prs.forEach(pr => loadPr(`review:${pr.url}`, pr));
  });
  useEffect(() => load(), [id, urls]);
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    const typing = e
      .composedPath()
      .some(n => n instanceof HTMLElement && n.matches("input, textarea, select, [contenteditable]"));
    if (e.key === "Escape" && !typing && !confirm && !e.defaultPrevented) {
      e.preventDefault();
      closeReview();
    }
  });
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  if (items.length)
    return (
      <div className={`${className} flex flex-col min-h-0`}>
        <ReviewScreen id={id} entries={items} />
      </div>
    );
  return (
    <div className={`${className} flex flex-col items-center justify-center gap-3 text-secondary`}>
      <Icon name="pr" className="glyph size-6" />
      <span className="text-[15px] text-label font-semibold">
        {loaded ? t("today.work.gone.review") : t("kb.loading")}
      </span>
      {loaded ? (
        <div className="flex gap-2">
          <button className="btn cursor-pointer" onClick={closeReview}>
            {t("today.backToToday")}
          </button>
          <button className="btn btn-primary cursor-pointer" onClick={() => discardReview(id)}>
            {t("today.work.discard")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
