import { useNavigationStore } from "../../../application/navigation/store";
import { answerRepo, repoAskFor } from "../../../application/pull-requests/prs";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { Html } from "../../components/Html";
import { strip } from "./layout";

/** Under the log of a project conversation that committed to a repo no project has: offers to link it to the project. */
export function RepoBar({ className }: { className: string }) {
  const { t, th } = useT();
  const selected = useNavigationStore(s => s.selected);
  const ask = useDerived(() => repoAskFor(selected));
  if (!ask) return null;
  return (
    <div className={className}>
      <div className={`${strip} border border-separator bg-fill`}>
        <Html html={th("repo.ask", ask)} />
        <span className="flex-1"></span>
        <button className="btn" onClick={() => answerRepo(selected, false)}>
          {t("repo.no")}
        </button>
        <button className="btn btn-primary" onClick={() => answerRepo(selected, true)}>
          {t("repo.yes")}
        </button>
      </div>
    </div>
  );
}
