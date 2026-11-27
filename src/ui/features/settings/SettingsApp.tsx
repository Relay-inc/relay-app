import { useSettingsStore } from "../../../application/settings/store";
import { go, openServersPage, TABS, TAB_GROUPS } from "../../../application/settings/window";
import { Icon } from "../../components/Icon";
import { useT } from "../../hooks/useT";
import { AccessPage } from "./AccessPage";
import { AgentsPage } from "./AgentsPage";
import { AutomationPage } from "./AutomationPage";
import { GeneralPage } from "./GeneralPage";
import { IntegrationsPage } from "./IntegrationsPage";
import { LabsPage } from "./LabsPage";
import { SettingsSearch } from "./SettingsSearch";
import { PluginsPage } from "./PluginsPage";
import { ProjectsPage } from "./ProjectsPage";
import { ShortcutsPage } from "./ShortcutsPage";
import { UpdatesPage } from "./UpdatesPage";
import { VaultPage } from "./VaultPage";
import { VoicePage } from "./VoicePage";

/** The settings window, laid out like bb's: the pages in a sidebar on the left, the shown page on the right. Every
 *  page stays mounted and only the shown one takes part in the column, so what is typed survives switching pages, and
 *  Agents and Integrations check their state once, when the window opens. Under the pages, Organisations and servers is a
 *  row, not a page: it opens that page in the main window and closes this one. Mounted once the settings are read. */
export function SettingsApp() {
  const { t } = useT();
  const picked = useSettingsStore(s => s.tab);
  const vaultStatus = useSettingsStore(s => s.vaultStatus);
  if (!vaultStatus) return null;
  const tab = picked;
  const page = (id: typeof tab) => (tab === id ? "contents" : "hidden");
  // Projects and Agents are a list and the picked item side by side, the full width; the other pages a centred column
  const wide = tab === "projects" || tab === "agents";
  // the window's line height is 1.4 (the body's is 1.5), set as a plain property: a leading-* utility would also set
  // --tw-leading, which every text-* below would then inherit
  return (
    <div className="flex h-full min-h-0 [line-height:1.4]">
      <nav className="w-52 flex-none overflow-y-auto border-r border-s-seam bg-s-side px-2 pt-12 select-none">
        <SettingsSearch>
          {/* four groups, a hairline between them */}
          {TAB_GROUPS.map((group, i) => (
            <div key={group[0][0]} className={`grid gap-px py-1 ${i ? "mt-1 border-t border-s-seam pt-2" : ""}`}>
              {group.map(([id, name, glyph]) => (
                <button
                  key={id}
                  className={`flex h-7 items-center gap-2.5 overflow-hidden rounded-[7px] px-2 text-[13px] text-s-fg focus-visible:ring-2 ring-s-ring focus-visible:outline-none ${tab === id ? "bg-s-sel font-medium" : "hover:bg-s-hover"}`}
                  onClick={() => go(id)}
                  aria-current={tab === id ? "page" : undefined}
                >
                  <Icon
                    name={glyph}
                    className={`size-4 flex-none fill-none stroke-current stroke-2 glyph ${tab === id ? "text-accent-text" : "text-secondary"}`}
                  />
                  <span className="min-w-0 flex-1 truncate text-left">{t(name)}</span>
                </button>
              ))}
            </div>
          ))}
        </SettingsSearch>
        <div className="mt-1 grid border-t border-s-seam pt-2">
          <button
            className="flex h-7 items-center gap-2.5 overflow-hidden rounded-[7px] px-2 text-[13px] text-s-fg hover:bg-s-hover focus-visible:ring-2 ring-s-ring focus-visible:outline-none"
            onClick={() => void openServersPage()}
          >
            <Icon name="building" className="size-4 flex-none fill-none stroke-current stroke-2 glyph text-secondary" />
            <span className="min-w-0 flex-1 truncate text-left">{t("srv.title")}</span>
            <Icon name="out" className="size-3.5 flex-none fill-none stroke-current stroke-2 glyph text-secondary" />
          </button>
        </div>
      </nav>
      <section className={`min-w-0 flex-1 min-h-0 ${wide ? "flex flex-col" : "overflow-y-auto"}`}>
        <div className="flex h-12 flex-none items-center border-b border-s-seam px-8 text-[13px] font-semibold">
          {t(TABS.find(x => x[0] === tab)![1])}
        </div>
        <div
          className={
            wide
              ? "flex min-h-0 flex-1"
              : "mx-auto grid max-w-150 grid-cols-1 content-start gap-7 px-8 pt-6 pb-10 [&>*]:min-w-0"
          }
        >
          <div className={page("general")} data-search-page="general">
            <GeneralPage />
          </div>
          <div className={page("vault")} data-search-page="vault">
            <VaultPage vaultStatus={vaultStatus} />
          </div>
          <div className={page("projects")} data-search-page="projects">
            <ProjectsPage active={tab === "projects"} />
          </div>
          <div className={page("agents")} data-search-page="agents">
            <AgentsPage />
          </div>
          <div className={page("integrations")} data-search-page="integrations">
            <IntegrationsPage active={tab === "integrations"} />
          </div>
          <div className={page("plugins")} data-search-page="plugins">
            <PluginsPage active={tab === "plugins"} />
          </div>
          <div className={page("voice")} data-search-page="voice">
            <VoicePage active={tab === "voice"} />
          </div>
          <div className={page("shortcuts")} data-search-page="shortcuts">
            <ShortcutsPage />
          </div>
          <div className={page("automation")} data-search-page="automation">
            <AutomationPage />
          </div>
          <div className={page("access")} data-search-page="access">
            <AccessPage active={tab === "access"} />
          </div>
          <div className={page("labs")} data-search-page="labs">
            <LabsPage />
          </div>
          <div className={page("updates")} data-search-page="updates">
            <UpdatesPage active={tab === "updates"} />
          </div>
        </div>
      </section>
    </div>
  );
}
