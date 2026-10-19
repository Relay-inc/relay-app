import type { Drawer } from "../../../domain/navigation/views";
import { useNavigationStore } from "../../../application/navigation/store";
import { closeDrawer } from "../../../application/navigation/panel";
import { selectedProject } from "../../../application/conversations/selectors";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";
import { PanelDetail } from "../navigation/PanelDetail";
import { TerminalsPanel } from "../terminals/TerminalsPanel";
import { ScratchPanel } from "../scratch/ScratchPanel";
import { WorkersColumn } from "../orchestrator/WorkersColumn";
import { ChangesPanel } from "../changes/ChangesPanel";
import { DesignPanel } from "../design/DesignPanel";
import { AgentsColumn } from "../agents/AgentsColumn";
import "../../styles/navigation.css";

const TITLES = {
  detail: "drawer.detail",
  terminal: "drawer.terminal",
  notes: "drawer.notes",
  design: "drawer.design",
  workers: "nav.orch",
  changes: "drawer.changes",
  agents: "agents.column",
} as const;

/** The right drawer, open on demand: a note's detail, one of the project's tools (terminals, notes), the
 *  open conversation's changes, or the orchestrator's workers next to its coordinator. */
export function DrawerView({ className, drawer }: { className: string; drawer: Exclude<Drawer, ""> }) {
  const { t } = useT();
  const project = useDerived(() => selectedProject()) ?? "";
  // the tool follows the project of what the middle column shows: a project's board or PRs keeps its tools
  const toolProject = useNavigationStore(s => s.tool?.project) ?? project;

  // app chrome is not text: no selection in the bar, like a native Mac app
  return (
    <aside className={`relay-drawer ${className}`}>
      <div className="flex flex-col flex-1 min-h-0 border-l border-separator">
        <div
          className="h-12 flex-none flex items-center gap-2 pl-4.5 pr-3 border-b border-separator min-w-(--drawer-w) select-none"
          data-tauri-drag-region
        >
          {/* the orchestrator's column belongs to it: its name, and it stays while the orchestrator is open */}
          {drawer === "workers" ? <Icon name="agent" className="glyph size-4 text-secondary" /> : null}
          <h2 className="flex-1 text-[15px] font-semibold">{t(TITLES[drawer])}</h2>
          {drawer === "workers" ? null : (
            <button className="btn-icon" title={t("pr.close")} aria-label={t("nav.close")} onClick={closeDrawer}>
              <Icon name="close" className="glyph size-4" />
            </button>
          )}
        </div>
        <div
          className={`min-w-(--drawer-w) ${drawer === "workers" || drawer === "agents" ? "overflow-y-auto pt-2.5 px-3 pb-4" : drawer === "detail" ? "overflow-y-auto pt-4.5 px-4.5 pb-6" : "flex-1 min-h-0 flex flex-col p-3"}`}
        >
          {drawer === "terminal" ? <TerminalsPanel project={toolProject} /> : null}
          {drawer === "notes" ? <ScratchPanel project={toolProject} /> : null}
          {drawer === "design" ? <DesignPanel project={toolProject} /> : null}
          {drawer === "detail" ? <PanelDetail /> : null}
          {drawer === "workers" ? <WorkersColumn /> : null}
          {drawer === "changes" ? <ChangesPanel /> : null}
          {drawer === "agents" ? <AgentsColumn /> : null}
        </div>
      </div>
    </aside>
  );
}
