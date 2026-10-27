import { useConversationsStore } from "../../../application/conversations/store";
import { useNavigationStore } from "../../../application/navigation/store";
import { useWorkspaceStore } from "../../../application/workspace/store";
import { aboutItems } from "../../../application/conversations/selectors";
import { moveTo } from "../../../application/conversations/actions";
import { sameVaultProjects } from "../../../domain/conversations/rules";
import { projectName } from "../../../application/workspace/vault";
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
  const general = useConversationsStore(s => s.chats[selected]?.vault);
  if (session)
    return (
      <div className={className}>
        <div className={`${strip} border border-separator bg-fill`}>
          <span>{t("move.term", { busy: session.busy ? t("move.termBusy") : "" })}</span>
        </div>
      </div>
    );
  // scores every message: only when the bar can show, and memoised on the items. The bar shows for a general
  // conversation that sent something, so a started one: it keeps running in its vault (src-tauri `fence`)
  const about = asked ? null : aboutItems(items, sameVaultProjects({ projects, vault }, general));
  if (!about) return null;
  const name = projectName(about);
  return (
    <div className={className}>
      <div className={`${strip} border border-separator bg-fill`}>
        <Html html={th("move.about", { name })} />
        <span className="flex-1"></span>
        <button className="btn" onClick={() => moveTo(null)}>
          {t("move.no")}
        </button>
        <button className="btn btn-primary" onClick={() => moveTo(about)}>
          {t("move.yes", { name })}
        </button>
      </div>
    </div>
  );
}
