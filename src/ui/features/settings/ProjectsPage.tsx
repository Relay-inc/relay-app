import { useEffect } from "react";
import { useSettingsStore } from "../../../application/settings/store";
import { findIcons, showProjectsPage } from "../../../application/settings/projects-page";
import { Html } from "../../components/Html";
import { useT } from "../../hooks/useT";
import { buttonClass, EMPTY_LIST, OPTIONAL_TEXT, STATUS_TEXT } from "./blocks";
import { Footer } from "./Footer";
import { LoadingSection } from "./LoadingSection";
import { ProjectIcon } from "./ProjectIcon";
import { ProjectSettings } from "./ProjectSettings";
import { Section } from "./Section";
import { SettingsFold } from "./SettingsFold";
import { useToggleSet } from "./useToggleSet";

/** Projects: every project, a row folds open to its configuration. The name in Relay stays in the app's settings; the
 *  icon and the repos live in the vault's .relay/config.json. Loaded the first time the page shows. */
export function ProjectsPage({ active }: { active: boolean }) {
  const { t, th, tn } = useT();
  const icons = useSettingsStore(s => s.projectsPage.icons);
  const names = useSettingsStore(s => s.projectsPage.names);
  const projects = useSettingsStore(s => s.projectsPage.projects);
  const repos = useSettingsStore(s => s.projectsPage.repos);
  const labels = useSettingsStore(s => s.settings.projects);
  const pageMessage = useSettingsStore(s => s.projectsPage.message);
  const finding = useSettingsStore(s => s.projectsPage.finding);
  const windowMessage = useSettingsStore(s => s.message);
  const folds = useToggleSet();
  useEffect(() => {
    if (active) showProjectsPage();
  }, [active]);

  if (!icons) return <LoadingSection title={t("set.tab.projects")} text={t("pr.loading")} />;

  // the context of the project and how many repos it has
  const summary = (name: string) => {
    const context = projects.find(project => project.name === name)?.context ?? "";
    const repoCount = repos[name]?.length;
    const parts = [context, repoCount ? tn("pc.repoCount", repoCount) : ""].filter(Boolean);
    return <span className={STATUS_TEXT}>{parts.join(" · ")}</span>;
  };
  const row = (name: string) => {
    const label = labels[name]?.label;
    const open = folds.isOpen(name);
    return (
      <SettingsFold
        key={name}
        id={name}
        open={open}
        onToggle={() => folds.toggle(name)}
        icon={<ProjectIcon icon={icons[name]} where="row" />}
        name={
          label ? (
            <>
              {label} <span className={`${OPTIONAL_TEXT} ml-1 font-normal`}>{name}</span>
            </>
          ) : (
            name
          )
        }
        status={summary(name)}
      >
        {open && <ProjectSettings name={name} icon={icons[name]} />}
      </SettingsFold>
    );
  };

  // the page's own message (an icon, repos), else the window's (a name saved)
  const message = pageMessage ?? windowMessage;
  return (
    <Section
      title={t("set.tab.projects")}
      desc={<Html html={th("pc.desc")} />}
      list
      footer={
        <>
          <button className={buttonClass()} onClick={findIcons} title={t("pi.findHelp")} disabled={finding}>
            {finding ? (
              <>
                <span className="spinner"></span> {t("pi.finding")}
              </>
            ) : (
              t("pi.find")
            )}
          </button>
          {message && <Footer message={message} />}
        </>
      }
    >
      {names.length ? names.map(row) : <div className={EMPTY_LIST}>{t("set.none")}</div>}
    </Section>
  );
}
