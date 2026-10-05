import { useSettingsStore } from "../../../application/settings/store";
import { go, TABS } from "../../../application/settings/window";
import { Icon } from "../../components/Icon";
import { useT } from "../../hooks/useT";
import { AgentsPage } from "./AgentsPage";
import { GeneralPage } from "./GeneralPage";
import { IntegrationsPage } from "./IntegrationsPage";
import { MachinesPage } from "./MachinesPage";
import { ProjectsPage } from "./ProjectsPage";
import { VoicePage } from "./VoicePage";

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
      <nav className="w-52 flex-none overflow-y-auto border-r border-s-seam bg-s-side px-2 pt-12 select-none">
        <div className="grid gap-px py-1">
          {TABS.map(([id, name, glyph], index) => (
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
              <span className="text-[11px] font-normal text-tertiary">⌘{index + 1}</span>
            </button>
          ))}
        </div>
      </nav>
      <section className="min-w-0 flex-1 min-h-0 overflow-y-auto">
        <div className="flex h-12 items-center border-b border-s-seam px-8 text-[13px] font-semibold">
          {t(TABS.find(x => x[0] === tab)![1])}
        </div>
        <div className="mx-auto grid max-w-150 grid-cols-1 content-start gap-7 px-8 pt-6 pb-10 [&>*]:min-w-0">
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
          <div className={page("machines")}>
            <MachinesPage active={tab === "machines"} />
          </div>
          <div className={page("voice")}>
            <VoicePage active={tab === "voice"} />
          </div>
        </div>
      </section>
    </div>
  );
}
