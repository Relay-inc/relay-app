import { useConversationsStore } from "../../../application/conversations/store";
import { useNavigationStore } from "../../../application/navigation/store";
import { useWorkspaceStore } from "../../../application/workspace/store";
import { aboutItems } from "../../../application/conversations/selectors";
import { moveTo } from "../../../application/conversations/actions";
import { hasStarted, projectsInVault } from "../../../domain/conversations/rules";
import { useT } from "../../hooks/useT";
import { Html } from "../../components/Html";
import { strip } from "./layout";

/** Under the log: a terminal session says it is read-only here (`session`), a general conversation may offer to
 *  move to the project it is about. `asked`: nothing to offer (a project, a view, a running turn, answered no). */
export function MoveBar({
  className,
  session,
  asked,
}: {
  className: string;
  session: { busy: boolean } | null;
  asked: boolean;
}) {
  const { t, th } = useT();
  const selected = useNavigationStore(s => s.selected);
  // the items only while the bar can show: a stream into a busy conversation does not redraw it
  const items = useConversationsStore(s => (asked || session ? undefined : s.messages[selected]));
  const projects = useWorkspaceStore(s => s.snap.projects);
  const vault = useWorkspaceStore(s => s.snap.vault);
  const from = useConversationsStore(s => s.chats[selected]?.project ?? null);
  // a started conversation keeps running in its vault (src-tauri `fence`): projects in another one are not offered
  const started = useConversationsStore(s => hasStarted(s, selected));
  if (session)
    return (
      <div className={className}>
        <div className={`${strip} border border-separator bg-fill`}>
          <span>{t("move.term", { busy: session.busy ? t("move.termBusy") : "" })}</span>
        </div>
      </div>
    );
  // scores every message: only when the bar can show, and memoised on the items
  const about = asked ? null : aboutItems(items, started ? projectsInVault({ projects, vault }, from) : projects);
  if (!about) return null;
  return (
    <div className={className}>
      <div className={`${strip} border border-separator bg-fill`}>
        <Html html={th("move.about", { name: about })} />
        <span className="flex-1"></span>
        <button className="btn" onClick={() => moveTo(null)}>
          {t("move.no")}
        </button>
        <button className="btn btn-primary" onClick={() => moveTo(about)}>
          {t("move.yes", { name: about })}
        </button>
      </div>
    </div>
  );
}
