import { PRS } from "../../../domain/navigation/views";
import { prKey } from "../../../domain/navigation/keys";
import type { PR } from "../../../domain/pull-requests/types";
import { usePullRequestsStore } from "../../../application/pull-requests/store";
import { useNavigationStore } from "../../../application/navigation/store";
import { openSettings, openTool } from "../../../application/navigation/navigation";
import { openPr } from "../../../application/navigation/panel";
import { useT } from "../../hooks/useT";
import { PrRow } from "../pull-requests/PrRow";

/** The project's PRs: what waits for your review, then what you opened. A row opens the PR in the Pull requests
 *  view (the project's own, as its old title bar button did), which is where a PR is read. */
export function PrsPanel({ project }: { project: string }) {
  const { t } = useT();
  const list = usePullRequestsStore(s => s.list);
  const linked = usePullRequestsStore(s => !!s.repos[project]?.length);
  const open = useNavigationStore(s => s.panel.prOpen);
  const show = async (pr: PR) => {
    const { tool, selected } = useNavigationStore.getState();
    if (!(tool?.project === project && selected === PRS)) await openTool(project, PRS);
    await openPr(prKey(pr.repo, pr.number));
  };
  if (!linked)
    return (
      <button
        type="button"
        className="self-start px-2 py-1.5 text-xs text-accent hover:underline cursor-pointer text-left"
        onClick={openSettings}
      >
        {t("bar.linkRepo")}
      </button>
    );
  const group = (name: string, prs: PR[]) => (
    <section>
      <h3 className="flex items-baseline gap-1.5 pt-1.5 pb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-tertiary">
        {name} <span className="tabular-nums">{prs.length}</span>
      </h3>
      {prs.length ? (
        prs.map(pr => (
          <PrRow
            key={prKey(pr.repo, pr.number)}
            pr={pr}
            compact
            selected={open === prKey(pr.repo, pr.number)}
            onOpen={() => show(pr)}
          />
        ))
      ) : (
        <div className="py-1.5 text-xs text-secondary">{t("pr.none")}</div>
      )}
    </section>
  );
  return (
    <div className="overflow-y-auto">
      {list ? (
        <>
          {group(
            t("nav.prsReview"),
            list.review.filter(pr => pr.project === project),
          )}
          {group(
            t("pr.mine"),
            list.mine.filter(pr => pr.project === project),
          )}
        </>
      ) : (
        <div className="py-1.5 text-xs text-secondary">{t("pr.notLoaded")}</div>
      )}
    </div>
  );
}
