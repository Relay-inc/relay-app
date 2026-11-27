import { useEffect, useState } from "react";
import { needsSetup } from "../../../domain/pipeline/rules";
import { provider as providerById } from "../../../shared/plugins";
import { useSettingsStore } from "../../../application/settings/store";
import { findIcons, showProjectsPage } from "../../../application/settings/projects-page";
import { Icon } from "../../components/Icon";
import { useT } from "../../hooks/useT";
import { BUTTON_GLYPH, buttonClass, EMPTY_LIST } from "./blocks";
import { Footer } from "./Footer";
import { LoadingSection } from "./LoadingSection";
import { ProjectIcon } from "./ProjectIcon";
import { ProjectSettings } from "./ProjectSettings";

type Filter = "all" | "on" | "setup";

/** Projects: the projects on the left (searched, filtered, by context), the picked one's settings on the right. The
 *  name in Relay stays in the app's settings; the icon and the repos live in the vault's .relay/config.json. Loaded
 *  the first time the page shows. */
export function ProjectsPage({ active }: { active: boolean }) {
  const { t, tn } = useT();
  const icons = useSettingsStore(s => s.projectsPage.icons);
  const names = useSettingsStore(s => s.projectsPage.names);
  const projects = useSettingsStore(s => s.projectsPage.projects);
  const repos = useSettingsStore(s => s.projectsPage.repos);
  const checkouts = useSettingsStore(s => s.projectsPage.checkouts);
  const labels = useSettingsStore(s => s.settings.projects);
  const pipelines = useSettingsStore(s => s.settings.pipelines);
  const boards = useSettingsStore(s => s.settings.boards);
  const pageMessage = useSettingsStore(s => s.projectsPage.message);
  const finding = useSettingsStore(s => s.projectsPage.finding);
  const windowMessage = useSettingsStore(s => s.message);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [picked, setPicked] = useState("");
  const [tab, setTab] = useState<"general" | "pipeline">("general");
  useEffect(() => {
    if (active) showProjectsPage();
  }, [active]);

  if (!icons) return <LoadingSection title={t("set.tab.projects")} text={t("pr.loading")} />;

  const projectOf = (name: string) => projects.find(project => project.name === name);
  // the name in Relay, else the snapshot's label: another vault's project has an opaque key
  const shownOf = (name: string) => labels[name]?.label || projectOf(name)?.label || name;
  const q = query.trim().toLowerCase();
  const shown = names.filter(name => {
    if (q && !`${shownOf(name)} ${projectOf(name)?.context ?? ""}`.toLowerCase().includes(q)) return false;
    if (filter === "on") return !!pipelines?.[name]?.on;
    if (filter === "setup") return needsSetup(repos[name] ?? [], checkouts[name] ?? [], pipelines?.[name]);
    return true;
  });
  // the picked project while the search and filter keep it, else the first they show
  const current = shown.includes(picked) ? picked : (shown[0] ?? "");
  const contexts = [...new Set(shown.map(name => projectOf(name)?.context ?? ""))].sort((a, b) => a.localeCompare(b));

  // how many repos it has and, with a board linked, its tracker and whether its pipeline is on
  const summary = (name: string) => {
    const count = repos[name]?.length ?? 0;
    const parts = [count ? tn("pc.repoCount", count) : t("pc.noRepos")];
    const board = boards?.[name];
    if (board) parts.push(providerById(board.provider)?.name ?? board.provider);
    if (board) parts.push(t(pipelines?.[name]?.on ? "pc.pipelineOn" : "pc.pipelineOff"));
    return parts.join(" · ");
  };
  const row = (name: string) => {
    const on = name === current;
    return (
      <button
        key={name}
        className={`flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-s-fg focus-visible:ring-2 ring-s-ring focus-visible:outline-none ${on ? "bg-s-sel" : "hover:bg-s-hover"}`}
        aria-current={on ? "true" : undefined}
        onClick={() => setPicked(name)}
      >
        <span className="grid size-7 flex-none place-items-center rounded-md border border-s-border">
          <ProjectIcon icon={icons[name]} where="tile" />
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate ${on ? "font-medium" : ""}`}>{shownOf(name)}</span>
          <span className="block truncate text-xs text-s-muted">{summary(name)}</span>
        </span>
      </button>
    );
  };
  const pill = (id: Filter, label: string) => (
    <button
      key={id}
      className={`h-6.5 rounded-lg border px-2.5 text-xs ${filter === id ? "border-transparent bg-s-sel font-medium text-accent-text" : "border-s-input text-s-fg hover:bg-s-hover"}`}
      aria-pressed={filter === id}
      onClick={() => setFilter(id)}
    >
      {label}
    </button>
  );

  // the page's own message (an icon, repos), else the window's (a name saved)
  const message = pageMessage ?? windowMessage;
  return (
    <>
      <aside
        aria-label={t("set.tab.projects")}
        className="flex w-72 flex-none flex-col gap-3 overflow-y-auto border-r border-s-seam px-3 py-4"
      >
        <div className="flex items-center gap-2">
          <input
            type="search"
            className="h-7.5 min-w-0 flex-1 rounded-lg border border-transparent bg-s-hover px-2.5 text-[13px] text-s-fg placeholder:text-s-subtle focus-visible:ring-1 ring-s-primary focus-visible:outline-none"
            placeholder={t("pc.search", { n: names.length })}
            aria-label={t("pc.searchLabel")}
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <button
            className={buttonClass("plain", true)}
            onClick={findIcons}
            title={t("pi.findHelp")}
            aria-label={t("pi.find")}
            disabled={finding}
          >
            {finding ? <span className="spinner"></span> : <Icon name="wand" className={BUTTON_GLYPH} />}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {pill("all", t("pc.all"))}
          {pill("on", t("pc.pipelineOn"))}
          {pill("setup", t("pc.needsSetup"))}
        </div>
        {message && (
          <div className="flex px-1">
            <Footer message={message} />
          </div>
        )}
        {shown.length ? (
          contexts.map(context => (
            <div key={context} className="grid gap-px">
              {context && (
                <div className="px-2.5 pt-1.5 pb-1 text-xs font-semibold tracking-wider text-s-muted uppercase">
                  {context}
                </div>
              )}
              {shown.filter(name => (projectOf(name)?.context ?? "") === context).map(row)}
            </div>
          ))
        ) : (
          <div className={`${EMPTY_LIST} px-2.5`}>{t("set.none")}</div>
        )}
      </aside>
      <main className="@container min-w-0 flex-1 overflow-y-auto px-8 pt-7 pb-12">
        {current && (
          <ProjectSettings
            key={current}
            name={current}
            icon={icons[current]}
            shown={shownOf(current)}
            tab={tab}
            onTab={setTab}
          />
        )}
      </main>
    </>
  );
}
