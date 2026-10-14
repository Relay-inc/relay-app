import { useNavigationStore } from "../../../application/navigation/store";
import { toggleDrawer } from "../../../application/navigation/navigation";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";

/** A conversation's title bar button once Claude Code spawned agents in it: their column, lit while it shows. */
export function AgentsToggle() {
  const { t } = useT();
  const on = useNavigationStore(s => s.drawer === "agents");
  return (
    <button
      className={`btn-icon ${on ? "bg-accent-soft text-accent-text!" : ""}`}
      title={t("agents.column")}
      aria-label={t("agents.column")}
      aria-pressed={on}
      onClick={() => toggleDrawer("agents")}
    >
      <Icon name="agent" className="glyph size-4" />
    </button>
  );
}
