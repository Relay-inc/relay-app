import { useEffect } from "react";
import { useSettingsStore } from "../../../application/settings/store";
import { loadSkills } from "../../../application/settings/agents-page";
import { buttonClass, EMPTY_LIST, PILL, STATUS_TEXT } from "./blocks";
import { useT } from "../../hooks/useT";
import { Section } from "./Section";

const SOURCES = { user: "ag.skillFrom.user", project: "ag.skillFrom.project", plugin: "ag.skillFrom.plugin" } as const;

/** Claude's skills in this vault: name, what it is for (full text on hover) and where it comes from. */
export function SkillsSection() {
  const { t } = useT();
  const skills = useSettingsStore(s => s.agentsPage.skills);
  useEffect(() => {
    void loadSkills();
  }, []);
  const source = (name: string) => (name in SOURCES ? t(SOURCES[name as keyof typeof SOURCES]) : name);
  return (
    <Section
      title={t("ag.skills")}
      desc={t("ag.skillsHelp")}
      action={
        <button className={buttonClass()} disabled={!skills} onClick={() => void loadSkills()}>
          {t("ag.skillsReload")}
        </button>
      }
    >
      {!skills ? (
        <div className={STATUS_TEXT}>
          <span className="spinner"></span>
          {t("ag.skillsLoading")}
        </div>
      ) : skills.length ? (
        <ul className="grid max-h-96 gap-2 overflow-y-auto">
          {skills.map(skill => (
            <li key={skill.name} className="grid min-w-0 gap-0.5" title={skill.description}>
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-[13px] font-medium text-s-fg">{skill.name}</span>
                <span className={PILL}>{source(skill.source)}</span>
                {skill.state !== "on" && <span className={PILL}>{skill.state}</span>}
              </div>
              <span className="truncate text-xs text-s-muted">{skill.description}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className={EMPTY_LIST}>{t("ag.skillsEmpty")}</div>
      )}
    </Section>
  );
}
