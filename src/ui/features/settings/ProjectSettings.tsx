import { useEffect, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import type { ProjectIcon as Icon } from "../../../domain/workspace/types";
import { isSite } from "../../../domain/workspace/rules";
import { EMPTY_PIPELINE } from "../../../domain/pipeline/rules";
import { useSettingsStore } from "../../../application/settings/store";
import {
  iconHint,
  loadCheckouts,
  setIconFromFile,
  setIconText,
  setLabel,
  setProjectIcon,
  setRepos,
} from "../../../application/settings/projects-page";
import { clearPipelineRepo, pickPipelineRepo, setPipelineRepo } from "../../../application/settings/pipeline";
import { Icon as AppIcon } from "../../components/Icon";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { BUTTON_GLYPH, buttonClass } from "./blocks";
import { BuddyProject } from "./BuddyProject";
import { CloudbuildProject } from "./CloudbuildProject";
import { ChangeInput } from "./ChangeInput";
import { Field } from "./Field";
import { PipelineSettings } from "./PipelineSettings";
import { ProjectBoard } from "./ProjectBoard";
import { ProjectIcon } from "./ProjectIcon";
import { Section } from "./Section";
import { Switch } from "./Switch";

export type ProjectTab = "general" | "pipeline";

/** A text field in the project's settings: the full width of its cell. */
export const TEXT =
  "h-7.5 min-w-0 rounded-lg border border-s-input bg-transparent px-2.5 text-[13px] text-s-fg placeholder:font-sans placeholder:text-s-subtle focus-visible:ring-1 ring-s-primary focus-visible:outline-none";
export const MONO = "font-mono text-xs";
export const HELP = "text-xs text-s-muted";
const SMALL_BUTTON = `${buttonClass()} h-6 px-2 text-xs font-normal`;

/** One project's settings, the right side of Settings › Projects: its header and two tabs, General (name, icon, board
 *  and repos) and Pipeline (PipelineSettings: the switch, the ticket flow, branches and checks, build and review). */
export function ProjectSettings({
  name,
  icon,
  shown,
  tab,
  onTab,
}: {
  name: string;
  icon: Icon | undefined;
  shown: string;
  tab: ProjectTab;
  onTab: (tab: ProjectTab) => void;
}) {
  const { t } = useT();
  const context = useSettingsStore(s => s.projectsPage.projects.find(project => project.name === name)?.context);
  const on = useSettingsStore(s => !!s.settings.pipelines?.[name]?.on);
  const tabButton = (id: ProjectTab, label: string, badge?: ReactNode) => (
    <button
      role="tab"
      aria-selected={tab === id}
      className={`-mb-px inline-flex h-11 items-center gap-1.5 border-b-2 px-0.5 text-[13px] font-medium focus-visible:outline-none focus-visible:ring-2 ring-s-ring ${tab === id ? "border-s-primary text-s-fg" : "border-transparent text-s-muted hover:text-s-fg"}`}
      onClick={() => onTab(id)}
    >
      {label}
      {badge}
    </button>
  );
  return (
    <div className="mx-auto grid max-w-240 grid-cols-1 gap-7 [&>*]:min-w-0">
      <header className="grid gap-4">
        <div className="flex items-center gap-3.5">
          <span className="grid size-11 flex-none place-items-center rounded-xl border border-s-border">
            <ProjectIcon icon={icon} where="big" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-semibold text-s-fg">{shown}</h1>
            {context && <div className="text-xs text-s-muted">{context}</div>}
          </div>
        </div>
        <nav role="tablist" aria-label={shown} className="flex gap-6 border-b border-s-seam">
          {tabButton("general", t("pc.general"))}
          {tabButton(
            "pipeline",
            t("pc.pipeline"),
            <span
              className={`rounded-md px-1.5 py-px text-xs font-medium ${on ? "bg-s-ok/15 text-s-ok" : "bg-s-hover text-s-muted"}`}
            >
              {t(on ? "pc.on" : "pc.off")}
            </span>,
          )}
        </nav>
      </header>
      {tab === "general" ? (
        <General name={name} icon={icon} shown={shown} onPipeline={() => onTab("pipeline")} />
      ) : (
        <PipelineSettings name={name} onGeneral={() => onTab("general")} />
      )}
    </div>
  );
}

/** A line saying where a setting is stored, with its icon: "This Mac only", "Vault, shared". */
function Where({ glyph, children }: { glyph: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <AppIcon name={glyph} className="size-3.5 flex-none fill-none stroke-current stroke-2" />
      {children}
    </span>
  );
}

/** The General tab: identity, the board, the repos with their checkouts on this Mac, Buddy's project. Each says
 *  where it is stored. The branches and the pipeline's switch are on the Pipeline tab. */
function General({
  name,
  icon,
  shown,
  onPipeline,
}: {
  name: string;
  icon: Icon | undefined;
  shown: string;
  onPipeline: () => void;
}) {
  const { t } = useT();
  const label = useSettingsStore(s => s.settings.projects[name]?.label ?? "");
  const placeholder = useSettingsStore(s => s.projectsPage.projects.find(p => p.name === name)?.label) || name;
  const hint = useDerived(() => iconHint(name));
  // one input for an emoji or a website; the buttons for an image, none and guessing again
  const iconText = icon?.icon ?? (icon && isSite(icon.value) ? icon.value : "");
  const onIconFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setIconFromFile(name, file);
  };

  return (
    <>
      <Section title={t("pc.identity")} rows>
        <Field wrap label={t("pc.name")} id={`pc-name-${name}`} hint={<Where glyph="laptop">{t("pc.thisMac")}</Where>}>
          <ChangeInput
            id={`pc-name-${name}`}
            className={`${TEXT} w-65`}
            value={label}
            placeholder={placeholder}
            spellCheck={false}
            onCommit={value => setLabel(name, value.trim())}
          />
        </Field>
        <Field
          wrap
          label={t("pc.icon")}
          id={`pc-icon-${name}`}
          hint={
            <Where glyph="folderLinked">
              {t("pc.synced")} · {hint}
            </Where>
          }
        >
          <span className="grid size-7.5 flex-none place-items-center rounded-lg border border-s-border">
            <ProjectIcon icon={icon} where="tile" />
          </span>
          <ChangeInput
            id={`pc-icon-${name}`}
            className={`${TEXT} w-38`}
            value={iconText}
            placeholder={t("pc.iconPh")}
            spellCheck={false}
            onCommit={value => setIconText(name, value.trim())}
          />
          <label className={buttonClass("plain", true)} title={t("pi.upload")}>
            <AppIcon name="upload" className={BUTTON_GLYPH} />
            <input type="file" accept="image/*,.ico,.svg" hidden onChange={onIconFile} />
          </label>
          <button
            className={buttonClass("plain", true)}
            onClick={() => setProjectIcon(name, "none")}
            title={t("pi.none")}
            aria-label={t("pi.none")}
          >
            <AppIcon name="none" className={BUTTON_GLYPH} />
          </button>
          <button
            className={buttonClass("plain", true)}
            onClick={() => setProjectIcon(name, "reset")}
            title={t("pi.reset")}
            aria-label={t("pi.reset")}
          >
            <AppIcon name="refresh" className={BUTTON_GLYPH} />
          </button>
        </Field>
      </Section>

      <ProjectBoard name={name} shown={shown} onPipeline={onPipeline} />

      <Section
        title={t("pc.repos")}
        desc={t("pc.reposHelp")}
        action={<span className={HELP}>{t("pc.reposWhere")}</span>}
        list
      >
        <Repos name={name} />
      </Section>

      <BuddyRow name={name} />
      <CloudbuildRow name={name} />
    </>
  );
}

/** Buddy's project, while Buddy is on: a row in a card of its own. */
function BuddyRow({ name }: { name: string }) {
  const on = useSettingsStore(s => s.settings.integrations.buddy?.on === true);
  if (!on) return null;
  return (
    <section className="rounded-xl border border-s-border px-4 py-3">
      <BuddyProject name={name} />
    </section>
  );
}

/** Cloud Build's project, while Cloud Build is on: a row in a card of its own. */
function CloudbuildRow({ name }: { name: string }) {
  const on = useSettingsStore(s => s.settings.integrations.cloudbuild?.on === true);
  if (!on) return null;
  return (
    <section className="rounded-xl border border-s-border px-4 py-3">
      <CloudbuildProject name={name} />
    </section>
  );
}

/** The repos: synced through the vault, each with its checkout on this Mac, whether agents may change it, and a
 *  remove; under them a field to add one and the checkout picked by hand. */
function Repos({ name }: { name: string }) {
  const { t } = useT();
  const synced = useSettingsStore(s => s.projectsPage.repos[name]) ?? [];
  const found = useSettingsStore(s => s.projectsPage.checkouts[name]) ?? [];
  const p = { ...EMPTY_PIPELINE, ...useSettingsStore(s => s.settings.pipelines?.[name]) };
  const [draft, setDraft] = useState("");
  useEffect(() => {
    loadCheckouts(name);
  }, [name]);
  // the synced repos in their order, then a checkout picked by hand of a repo not among them
  const slugs = [...synced, ...found.map(r => r.slug).filter(slug => !synced.includes(slug))];
  const add = (e: FormEvent) => {
    e.preventDefault();
    const repo = draft.trim();
    if (!repo || synced.includes(repo)) return;
    setDraft("");
    setRepos(name, [...synced, repo]);
  };
  const cell = "border-b border-s-border px-4 py-3";
  const head = `${cell} py-2.5 text-xs font-medium text-s-muted`;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-140 border-collapse text-left">
        <thead>
          <tr>
            <th className={head}>{t("pc.colRepo")}</th>
            <th className={head}>{t("pc.colCheckout")}</th>
            <th className={`${head} text-right whitespace-nowrap`}>{t("pc.colAgents")}</th>
            <th className={`${head} w-10 px-0`}>
              <span className="sr-only">{t("pc.colActions")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {slugs.map(slug => {
            const checkout = found.find(r => r.slug === slug);
            const byHand = !synced.includes(slug);
            return (
              <tr key={slug}>
                <td className={`${cell} font-mono text-xs whitespace-nowrap`}>{slug}</td>
                <td className={cell}>
                  <span className="flex items-center gap-2">
                    {checkout ? (
                      <span
                        className={`${MONO} inline-flex max-w-48 min-w-0 items-center gap-1.5 text-s-muted`}
                        title={checkout.path}
                      >
                        <AppIcon name="check" className="size-3.5 flex-none fill-none stroke-s-ok stroke-2" />
                        <span className="truncate">{checkout.path.replace(/^\/Users\/[^/]+/, "~")}</span>
                      </span>
                    ) : (
                      <span className="text-xs text-s-warn">{t("pc.notFound")}</span>
                    )}
                    <button className={SMALL_BUTTON} title={t("pl.repoHelp")} onClick={() => pickPipelineRepo(name)}>
                      {checkout ? t("pc.change") : t("pc.pickFolder")}
                    </button>
                  </span>
                </td>
                <td className={`${cell} text-right`}>
                  <span className="inline-flex align-middle">
                    <Switch
                      id={`pc-agents-${name}-${slug}`}
                      label={t("pl.repoOn", { repo: slug })}
                      on={!!checkout && !p.repos?.[slug]?.off}
                      disabled={!checkout}
                      onToggle={on => setPipelineRepo(name, slug, { off: !on })}
                    />
                  </span>
                </td>
                <td className={`${cell} py-2 pr-2 pl-0`}>
                  <button
                    className={`${buttonClass("ghost", true)} size-7`}
                    title={t("pc.remove", { repo: slug })}
                    aria-label={t("pc.remove", { repo: slug })}
                    onClick={() =>
                      byHand
                        ? clearPipelineRepo(name, checkout?.path ?? "")
                        : setRepos(
                            name,
                            synced.filter(x => x !== slug),
                          )
                    }
                  >
                    <AppIcon name="close" className={`${BUTTON_GLYPH} size-3.5`} />
                  </button>
                </td>
              </tr>
            );
          })}
          <tr>
            <td colSpan={4} className="px-4 py-2.5">
              <form className="flex flex-wrap items-center gap-2" onSubmit={add}>
                <input
                  className={`${TEXT} ${MONO} w-65`}
                  placeholder="owner/repo"
                  aria-label={t("pc.addRepoLabel")}
                  spellCheck={false}
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                />
                <button type="submit" className={buttonClass()} disabled={!draft.trim()}>
                  {t("pc.addRepo")}
                </button>
                <span className="flex-1"></span>
                <button
                  type="button"
                  className="text-xs text-accent-text hover:underline"
                  title={t("pl.repoHelp")}
                  onClick={() => pickPipelineRepo(name)}
                >
                  {t("pc.addCheckout")}
                </button>
              </form>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
