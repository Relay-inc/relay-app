import { useEffect, useEffectEvent } from "react";
import { reviewOf } from "../../../domain/navigation/views";
import { entries } from "../../../application/today/today";
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
  const entry = useDerived(() => entries().find(item => item.id === id));
  const loaded = usePullRequestsStore(s => !!s.list);
  const confirm = useReviewStore(s => !!s.reviews[id]?.confirm);
  const pr = entry?.subject.type === "pr" ? entry.subject.pr : null;
  const load = useEffectEvent(() => {
    if (pr) openReview(id, pr);
  });
  useEffect(() => load(), [id, pr?.url]);
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

  if (entry && pr)
    return (
      <div className={`${className} flex flex-col min-h-0`}>
        <ReviewScreen entry={entry} />
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
