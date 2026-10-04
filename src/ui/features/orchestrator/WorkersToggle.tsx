import { useNavigationStore } from "../../../application/navigation/store";
import { toggleDrawer } from "../../../application/navigation/navigation";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";

/** The coordinator's title bar button: its workers in the drawer, lit while they show. */
export function WorkersToggle() {
  const { t } = useT();
  const on = useNavigationStore(s => s.drawer === "workers");
  return (
    <button
      className={`btn-icon ${on ? "bg-accent-soft text-accent-text!" : ""}`}
      title={t("orch.workers")}
      aria-label={t("orch.workers")}
      aria-pressed={on}
      onClick={() => toggleDrawer("workers")}
    >
      <Icon name="workflow" className="glyph size-4" />
    </button>
  );
}
