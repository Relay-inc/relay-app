import { isTab, type Drawer } from "../../../domain/navigation/views";
import { useNavigationStore } from "../../../application/navigation/store";
import { closeDrawer } from "../../../application/navigation/panel";
import { openDrawer } from "../../../application/navigation/navigation";
import { selectedProject } from "../../../application/conversations/selectors";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { useKeyLabel } from "../../hooks/useKeyLabel";
import { Icon } from "../../components/Icon";
import { WorkersColumn } from "../orchestrator/WorkersColumn";
import { ATTENTION_TEXT, tabOf, useProjectTabs } from "./tabs";
import { AgentsColumn } from "../agents/AgentsColumn";
import { ArtifactPanel } from "../artifacts/ArtifactPanel";
import "../../styles/navigation.css";

const TITLES = {
  workers: "nav.orch",
  agents: "agents.column",
  artifact: "drawer.artifact",
} as const;

/** The right drawer, open on demand: the project panel, its tabs in the header (PRs, builds, git repos, folders,
 *  terminals: ./tabs), or the orchestrator's workers next to its coordinator, a conversation's agents or Artifact. */
export function DrawerView({ className, drawer }: { className: string; drawer: Exclude<Drawer, ""> }) {
  const { t } = useT();
  const escape = useKeyLabel("app.escape");
  const project = useDerived(() => selectedProject()) ?? "";
  // the tool follows the project of what the middle column shows: a project's board or PRs keeps its tools
  const toolProject = useNavigationStore(s => s.tool?.project) ?? project;
  const tabs = useProjectTabs(toolProject);
  const Panel = isTab(drawer) ? tabOf(drawer).Panel : null;

  // app chrome is not text: no selection in the bar, like a native Mac app
  return (
    <aside className={`relay-drawer ${className}`}>
      <div className="flex flex-col flex-1 min-h-0 min-w-(--drawer-col) border-l border-separator">
        <div
          className={`h-12 flex-none flex items-center gap-2 ${Panel ? "pl-2.5" : "pl-4.5"} pr-3 border-b border-separator select-none`}
          data-tauri-drag-region
        >
          {Panel ? (
            <div className="flex-1 flex items-center gap-0.5 min-w-0">
              {tabs.map(({ id, attention }) => {
                const tab = tabOf(id);
                const on = id === drawer;
                const state = attention ? `, ${t(`drawer.attn.${attention}`)}` : "";
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={on}
                    title={t(tab.label)}
                    aria-label={t(tab.label) + state}
                    className={`relative h-7.5 inline-flex items-center gap-1.5 rounded-lg text-[13px] cursor-default ${on ? "px-2.5 bg-accent-soft text-accent-text font-medium" : "w-8 justify-center text-secondary hover:bg-fill-2 hover:text-label"}`}
                    onClick={() => openDrawer(id)}
                  >
                    {tab.icon}
                    {on ? t(tab.label) : null}
                    {attention && !on ? (
                      <span
                        className={`absolute right-1.5 bottom-1 size-1.5 rounded-full bg-current ${ATTENTION_TEXT[attention]}`}
                      ></span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : (
            <>
              {/* the orchestrator's column belongs to it: its name, and it stays while the orchestrator is open */}
              {drawer === "workers" ? <Icon name="agent" className="glyph size-4 text-secondary" /> : null}
              <h2 className="flex-1 text-[15px] font-semibold">{t(TITLES[drawer as keyof typeof TITLES])}</h2>
            </>
          )}
          {drawer === "workers" ? null : (
            <button
              className="btn-icon"
              title={t("pr.close", { key: escape })}
              aria-label={t("nav.close")}
              onClick={closeDrawer}
            >
              <Icon name="close" className="glyph size-4" />
            </button>
          )}
        </div>
        <div
          className={`${drawer === "workers" || drawer === "agents" ? "overflow-y-auto pt-2.5 px-3 pb-4" : "flex-1 min-h-0 flex flex-col p-3"}`}
        >
          {Panel ? <Panel project={toolProject} /> : null}
          {drawer === "workers" ? <WorkersColumn /> : null}
          {drawer === "agents" ? <AgentsColumn /> : null}
          {drawer === "artifact" ? <ArtifactPanel /> : null}
        </div>
      </div>
    </aside>
  );
}
