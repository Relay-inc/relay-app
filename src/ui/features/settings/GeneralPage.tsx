import type { TerminalApp } from "../../../domain/settings/types";
import { useSettingsStore } from "../../../application/settings/store";
import {
  changeAccent,
  changeLanguage,
  changeTheme,
  saveWorkerCrabs,
  saveGitDrawer,
  saveSidebar,
  saveTerminal,
  showView,
  sidebarViews,
} from "../../../application/settings/general-page";
import { Glyph } from "../../components/Glyph";
import { Html } from "../../components/Html";
import { Icon } from "../../components/Icon";
import { Select } from "../../components/Select";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { buttonClass, SELECT, TILE } from "./blocks";
import { Field } from "./Field";
import { RunDefault } from "./RunDefault";
import { Section } from "./Section";
import { Segmented } from "./Segmented";
import { Switch } from "./Switch";

// Relay blue is the fixed brand colour (it must not follow the current accent); graphite is the text colour
const SWATCH = { relay: "bg-[#3a5ffb]", graphite: "bg-label" };

/** General: how Relay looks and the apps it opens (appearance, accent, the orchestrator's crabs, language, terminal),
 *  the Git button of a project's conversation and the views on top of the sidebar. Until its page takes it over,
 *  where conversations run stays at the bottom. */
export function GeneralPage() {
  const { t, th } = useT();
  const language = useSettingsStore(s => s.settings.language);
  const theme = useSettingsStore(s => s.settings.theme || "system");
  const accent = useSettingsStore(s => s.settings.accent || "relay");
  const terminal = useSettingsStore(s => s.settings.terminal || "auto");
  const sidebarLayout = useSettingsStore(s => s.settings.sidebar?.layout ?? "icons");
  const reordered = useSettingsStore(s => !!s.settings.sidebar?.order?.length);
  const views = useDerived(sidebarViews);
  const more = useSettingsStore(s => s.settings.sidebar?.more !== false);
  const workerCrabs = useSettingsStore(s => s.settings.workerCrabs !== false);
  const gitDrawer = useSettingsStore(s => s.settings.gitDrawer === true);
  // language names stay in their own language, so they are findable whatever the app is set to
  const languages = [
    { id: "system", name: t("set.system") },
    { id: "en", name: "English" },
    { id: "nl", name: "Nederlands" },
    { id: "fr", name: "Français" },
    { id: "de", name: "Deutsch" },
  ];
  const themes = [
    ["system", t("set.themeSystem")],
    ["light", t("set.themeLight")],
    ["dark", t("set.themeDark")],
  ] as const;
  const terminals = [
    { id: "auto", name: t("set.terminalAuto") },
    { id: "iterm", name: "iTerm" },
    { id: "wezterm", name: "WezTerm" },
    { id: "terminal", name: "Terminal" },
  ];
  const layouts = [
    ["list", t("set.sidebarList")],
    ["icons", t("set.sidebarIcons")],
  ] as const;
  return (
    <>
      <Section title={t("set.sec.appearance")} rows>
        <Field label={t("set.theme")} hint={<Html html={th("set.themeHelp")} />}>
          <Segmented label={t("set.theme")} options={themes} value={theme} onPick={changeTheme} />
        </Field>
        <Field label={t("set.accent")} hint={<Html html={th("set.accentHelp")} />}>
          <div className="flex gap-2.5" role="radiogroup" aria-label={t("set.accent")}>
            {(["relay", "graphite"] as const).map(value => (
              <button
                key={value}
                role="radio"
                aria-checked={accent === value}
                className={`flex h-7 items-center gap-1.5 rounded-lg border bg-transparent pr-2.5 pl-1.5 text-xs font-medium text-s-fg focus-visible:ring-1 ring-s-primary focus-visible:outline-none ${accent === value ? "border-accent" : "border-s-input"}`}
                onClick={() => changeAccent(value)}
              >
                <span className={`size-4 rounded-full inset-ring inset-ring-black/10 ${SWATCH[value]}`}></span>
                {t(`set.accent.${value}`)}
              </button>
            ))}
          </div>
        </Field>
        <Field label={t("set.workerCrabs")} id="crabs" hint={<Html html={th("set.workerCrabsHelp")} />}>
          <Switch id="crabs" on={workerCrabs} onToggle={saveWorkerCrabs} />
        </Field>
      </Section>
      <Section title={t("set.sec.langApps")} rows>
        <Field label={t("set.language")} id="language" hint={<Html html={th("set.languageHelp")} />}>
          <Select
            className={SELECT}
            id="language"
            options={languages}
            value={language || "system"}
            onChange={changeLanguage}
          />
        </Field>
        <Field label={t("set.terminal")} id="terminal" hint={<Html html={th("set.terminalHelp")} />}>
          <Select
            className={SELECT}
            id="terminal"
            options={terminals}
            value={terminal}
            onChange={value => saveTerminal(value as TerminalApp)}
          />
        </Field>
      </Section>
      <Section title={t("set.sec.titleBar")} rows>
        <Field
          label={t("set.gitDrawer")}
          id="gitdrawer"
          hint={<Html html={th("set.gitDrawerHelp")} />}
          info={t("set.gitDrawerInfo")}
        >
          <Switch id="gitdrawer" on={gitDrawer} onToggle={saveGitDrawer} />
        </Field>
      </Section>
      <Section title={t("set.sec.sidebar")} rows>
        <Field label={t("set.sidebarLayout")} hint={<Html html={th("set.sidebarLayoutHelp")} />}>
          <Segmented
            label={t("set.sidebarLayout")}
            options={layouts}
            value={sidebarLayout}
            onPick={layout => saveSidebar({ layout })}
          />
        </Field>
        <Field label={t("set.sidebarItems")} hint={<Html html={th("set.sidebarItemsHelp")} />}>
          {reordered && (
            <button className={buttonClass()} onClick={() => saveSidebar({ order: [] })}>
              {t("nav.resetOrder")}
            </button>
          )}
        </Field>
        {/* one switch per view, in the order of the sidebar */}
        {views.map(view => (
          <Field
            key={view.key}
            id={`sb-${view.key}`}
            label={
              <span className="inline-flex items-center gap-2">
                {view.mark ? (
                  <Glyph svg={view.mark} className={TILE} viewBox="0 0 24 24" />
                ) : (
                  <Icon name={view.icon ?? ""} className={TILE} />
                )}
                {view.name}
              </span>
            }
          >
            <Switch id={`sb-${view.key}`} on={view.shown} onToggle={on => showView(view.key, on)} />
          </Field>
        ))}
        <Field
          id="sb-more"
          label={
            <span className="inline-flex items-center gap-2">
              <Icon name="more" className={TILE} />
              {t("set.sidebarMore")}
            </span>
          }
        >
          <Switch id="sb-more" on={more} onToggle={on => saveSidebar({ more: on })} />
        </Field>
      </Section>
      <RunDefault />
    </>
  );
}
