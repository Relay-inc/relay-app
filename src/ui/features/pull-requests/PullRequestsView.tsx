import type { PR } from "../../../domain/pull-requests/types";
import { usePullRequestsStore } from "../../../application/pull-requests/store";
import { useNavigationStore } from "../../../application/navigation/store";
import { openDetail } from "../../../application/navigation/panel";
import { prKey } from "../../../domain/navigation/keys";
import { loadPrs } from "../../../application/pull-requests/prs";
import { projectLabel } from "../../../application/workspace/vault";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { PrRow } from "./PrRow";

/** The Pull requests view: both lists, with a reload button. */
export function PullRequestsView() {
  const { t } = useT();
  const list = usePullRequestsStore(s => s.list);
  const err = usePullRequestsStore(s => s.err);
  const busy = usePullRequestsStore(s => s.busy);
  const open = useNavigationStore(s => s.panel.open);
  // the display label per project the PRs name
  const labels = useDerived(() =>
    Object.fromEntries(
      [...(list?.review || []), ...(list?.mine || [])].flatMap(pr =>
        pr.project ? [[pr.project, projectLabel(pr.project)]] : [],
      ),
    ),
  );

  const group = (name: string, prs: PR[], mine: boolean) => (
    <section className="mb-6">
      <h2 className="list-head">
        {name} <span className="font-mono tabular-nums">{prs.length}</span>
      </h2>
      {prs.length ? (
        prs.map(pr => {
          const key = prKey(pr.repo, pr.number);
          return (
            <PrRow
              key={key}
              pr={pr}
              mine={mine}
              project={pr.project ? labels[pr.project] : ""}
              selected={open === key}
              onOpen={() => openDetail(key)}
            />
          );
        })
      ) : (
        <div className="text-secondary text-sm py-2">{t("pr.none")}</div>
      )}
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
  else if (!busy) lists = <div className="text-secondary text-sm text-center">{t("pr.notLoaded")}</div>;
  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex items-center gap-2 mb-3.5">
        <span className="flex-1"></span>
        {busy ? <span className="spinner"></span> : null}
        <button className="btn" onClick={loadPrs}>
          {t("pr.reload")}
        </button>
      </div>
      {err ? <div className="err-box">{err}</div> : null}
      {lists}
    </div>
  );
}
