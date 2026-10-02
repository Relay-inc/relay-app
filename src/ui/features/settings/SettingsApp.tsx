import { useSettingsStore } from "../../../application/settings/store";
import { go, TABS } from "../../../application/settings/window";
import { Icon } from "../../components/Icon";
import { useT } from "../../hooks/useT";
import { AgentsPage } from "./AgentsPage";
import { GeneralPage } from "./GeneralPage";
import { IntegrationsPage } from "./IntegrationsPage";
import { ProjectsPage } from "./ProjectsPage";

/** The settings window, laid out like bb's: the pages in a sidebar on the left, the shown page on the right. Every
 *  page stays mounted and only the shown one takes part in the column, so what is typed survives switching pages, and
 *  Agents and Integrations check their state once, when the window opens. Mounted once the settings are read. */
export function SettingsApp() {
  const { t } = useT();
  const tab = useSettingsStore(s => s.tab);
  const vaultStatus = useSettingsStore(s => s.vaultStatus);
  if (!vaultStatus) return null;
  const page = (id: typeof tab) => (tab === id ? "contents" : "hidden");
  // the window's line height is 1.4 (the body's is 1.5), set as a plain property: a leading-* utility would also set
  // --tw-leading, which every text-* below would then inherit
  return (
    <div className="flex h-full min-h-0 [line-height:1.4]">
      <nav className="w-50 flex-none overflow-y-auto border-r border-s-seam bg-s-side px-2 py-3 select-none">
        <div className="mt-1 grid gap-0.5 first:mt-0">
          {TABS.map(([id, name, glyph]) => (
            <button
              key={id}
              className={`flex h-7 items-center gap-2 overflow-hidden rounded-md px-2 text-sm text-s-fg hover:bg-s-sel focus-visible:ring-2 ring-s-ring focus-visible:outline-none ${tab === id ? "bg-s-sel" : ""}`}
              onClick={() => go(id)}
              aria-current={tab === id ? "page" : undefined}
            >
              <Icon name={glyph} className="size-4 flex-none fill-none stroke-current stroke-2 glyph" />
              <span className="min-w-0 flex-1 truncate text-left">{t(name)}</span>
            </button>
          ))}
        </div>
      </nav>
      <section className="min-w-0 flex-1 min-h-0 overflow-y-auto px-6 pt-5 pb-6">
        <div className="mx-auto grid max-w-2xl grid-cols-1 content-start gap-8 [&>*]:min-w-0">
          <div className={page("general")}>
            <GeneralPage vaultStatus={vaultStatus} />
          </div>
          <div className={page("projects")}>
            <ProjectsPage active={tab === "projects"} />
          </div>
          <div className={page("agents")}>
            <AgentsPage />
          </div>
          <div className={page("integrations")}>
            <IntegrationsPage active={tab === "integrations"} />
          </div>
        </div>
      </section>
    </div>
  );
}
