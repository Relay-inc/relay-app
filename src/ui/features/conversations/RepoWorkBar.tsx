import { useConversationsStore } from "../../../application/conversations/store";
import { useNavigationStore } from "../../../application/navigation/store";
import { answerRepoWork } from "../../../application/conversations/actions";
import { useT } from "../../hooks/useT";
import { Html } from "../../components/Html";
import { strip } from "./layout";

/** Under the log of a conversation that was to move from a machine back to this Mac while a repo of its project has
 *  work there that is not pushed: push it to the machine's branch and move, move anyway, or stay. */
export function RepoWorkBar({ className }: { className: string }) {
  const { t, th } = useT();
  const selected = useNavigationStore(s => s.selected);
  const work = useConversationsStore(s => s.repoWork[selected]);
  if (!work) return null;
  return (
    <div className={className}>
      <div className={`${strip} border border-separator bg-fill`}>
        <Html html={th("move.repoWork", { repo: work.repo, machine: work.machine })} />
        <span className="flex-1"></span>
        <button className="btn" disabled={work.busy} onClick={() => answerRepoWork(null)}>
          {t("move.repoCancel")}
        </button>
        <button className="btn" disabled={work.busy} onClick={() => answerRepoWork("move")}>
          {t("move.repoAnyway")}
        </button>
        <button className="btn btn-primary" disabled={work.busy} onClick={() => answerRepoWork("push")}>
          {t("move.repoPush", { branch: work.branch })}
        </button>
      </div>
    </div>
  );
}
