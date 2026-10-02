import type { PrDetail } from "../../../domain/pull-requests/types";
import { useNavigationStore } from "../../../application/navigation/store";
import { closeDetail } from "../../../application/navigation/panel";
import { reviewPr } from "../../../application/pull-requests/prs";
import { useT } from "../../hooks/useT";
import { DetailFrame } from "../../components/DetailFrame";
import { PrBody } from "./PrBody";

/** One PR in the right panel: the bar, then the body once github_pr has answered. */
export function PullRequestDetail({ panelKey }: { panelKey: string }) {
  const { t } = useT();
  const pr = useNavigationStore(s => s.panel.detail[panelKey]) as PrDetail | undefined;
  const err = useNavigationStore(s => s.panel.err);
  const actions = pr ? (
    <>
      <span className="flex-1"></span>
      <button
        className="btn btn-primary whitespace-nowrap flex-none"
        title={t("pr.reviewTitle")}
        onClick={() => reviewPr(panelKey)}
      >
        {t("pr.review")}
      </button>
      <a className="btn whitespace-nowrap flex-none inline-flex items-center" href={pr.url}>
        {t("pr.openGh")}
      </a>
    </>
  ) : null;
  return (
    <DetailFrame
      closeLabel={t("pr.close")}
      onClose={closeDetail}
      bar={actions}
      err={err}
      loading={pr ? undefined : t("pr.loading")}
    >
      {pr ? <PrBody pr={pr} /> : null}
    </DetailFrame>
  );
}
