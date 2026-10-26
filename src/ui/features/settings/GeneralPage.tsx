import { useState } from "react";
import type { Key } from "../../../shared/i18n";
import { KEYS, type MapKey, type VaultMap, type VaultStatus } from "../../../domain/workspace/types";
import type { TerminalApp } from "../../../domain/settings/types";
import { useSettingsStore } from "../../../application/settings/store";
import {
  changeAccent,
  changeLanguage,
  changeTheme,
  checkMap,
  pickMappedFile,
  pickVaultFolder,
  addExtraVault,
  removeExtraVault,
  saveFavicons,
  saveKeepAwake,
  saveAutoRetry,
  saveTimeFromSessions,
  saveCaptureOnClose,
  saveWorkerCrabs,
  saveFolders,
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
import { ActionsSection } from "./ActionsSection";
import { buttonClass, OPTIONAL_TEXT, SELECT, TILE, withoutColon } from "./blocks";
import { Field } from "./Field";
import { Footer } from "./Footer";
import { PathField } from "./PathField";
import { PermissionsSection } from "./PermissionsSection";
import { Section } from "./Section";
import { Segmented } from "./Segmented";
import { Switch } from "./Switch";
import { VaultSyncSection } from "./VaultSyncSection";

const NONE: string[] = [];
const trimmed = (map: VaultMap) => Object.fromEntries(KEYS.map(([key]) => [key, map[key].trim()])) as VaultMap;

// Relay blue is the fixed brand colour (it must not follow the current accent); graphite is the text colour
const SWATCH = { relay: "bg-[#3a5ffb]", graphite: "bg-label" };

/** General: the vault folder with its mapping, its git backup, what agents may do with reminders, the interface (language, colour
 *  scheme, accent, favicons, terminal), the views on top of the sidebar and what macOS lets Relay do. */
export function GeneralPage({ vaultStatus, active }: { vaultStatus: VaultStatus; active: boolean }) {
  const { t, th } = useT();
  const language = useSettingsStore(s => s.settings.language);
  const theme = useSettingsStore(s => s.settings.theme || "system");
  const accent = useSettingsStore(s => s.settings.accent || "relay");
  const terminal = useSettingsStore(s => s.settings.terminal || "auto");
  const sidebarLayout = useSettingsStore(s => s.settings.sidebar?.layout ?? "icons");
  const reordered = useSettingsStore(s => !!s.settings.sidebar?.order?.length);
  const views = useDerived(sidebarViews);
  const more = useSettingsStore(s => s.settings.sidebar?.more !== false);
  const faviconsOn = useSettingsStore(s => s.settings.favicons?.on !== false);
  const keepAwake = useSettingsStore(s => s.settings.keepAwake !== false);
  const autoRetry = useSettingsStore(s => s.settings.autoRetry === true);
  const timeFromSessions = useSettingsStore(s => s.settings.timeFromSessions !== false);
  const captureOnClose = useSettingsStore(s => s.settings.captureOnClose !== false);
  const workerCrabs = useSettingsStore(s => s.settings.workerCrabs !== false);
  const message = useSettingsStore(s => s.message);
  const extraVaults = useSettingsStore(s => s.settings.extraVaults ?? NONE);
  const extraRead = useSettingsStore(s => s.extraVaults);
  // the vault mapping as it is being edited, back to what the backend says whenever the vault status changes
  const [map, setMap] = useState(vaultStatus.map);
  const [mapOf, setMapOf] = useState(vaultStatus);
  if (mapOf !== vaultStatus) {
    setMapOf(vaultStatus);
    setMap(vaultStatus.map);
  }

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
  const mapping = ([key, , required]: [MapKey, boolean, boolean]) => {
    const configured = vaultStatus.map[key];
    const found = required || configured ? vaultStatus.found[key] : null;
    return (
      <Field
        key={key}
        label={
          <>
            <Html html={th(`vault.k.${key}` as Key)} />
            {!required && (
              <>
                {" "}
                <span className={OPTIONAL_TEXT}>{t("vault.optional")}</span>
              </>
            )}
          </>
        }
        hint={<Html html={th(`vault.h.${key}` as Key)} />}
      >
        <PathField
          value={map[key]}
          tip={configured}
          found={found}
          foundTip={found == null ? "" : t(found ? "vault.found" : "vault.missing")}
          pickTip={t("vault.pickPath")}
          onInput={value => setMap({ ...map, [key]: value })}
          onCommit={() => checkMap(trimmed(map))}
          onPick={() => pickMappedFile(key, trimmed(map))}
        />
      </Field>
    );
  };

  return (
    <>
      <Section title={withoutColon(t("set.vaultLabel"))} desc={<Html html={th("set.vaultHelp")} />}>
        <PathField
          value={vaultStatus.vault}
          tip={vaultStatus.vault}
          wide
          readOnly
          placeholder={t("vault.none")}
          pickTip={t("vault.pickPath")}
          onPick={pickVaultFolder}
        />
      </Section>
      <Section title={t("set.extraVaults")} desc={<Html html={th("set.extraVaultsHelp")} />}>
        <div className="flex flex-col gap-2">
          {extraVaults.map(vault => {
            const read = extraRead.find(x => x.vault === vault);
            return (
              <div key={vault} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate text-xs text-s-fg" title={vault}>
                    {vault}
                  </code>
                  <button
                    className={buttonClass("ghost")}
                    aria-label={t("set.extraVaultRemove", { name: vault })}
                    onClick={() => removeExtraVault(vault)}
                  >
                    {t("ag.remove")}
                  </button>
                </div>
                {read?.error && <p className="text-xs text-s-warn">{read.error}</p>}
                {!!read?.skipped.length && (
                  <p className="text-xs text-s-muted">
                    {t("set.extraVaultSkipped", { names: read.skipped.join(", ") })}
                  </p>
                )}
              </div>
            );
          })}
          <div>
            <button className={buttonClass()} onClick={addExtraVault}>
              {t("set.extraVaultAdd")}
            </button>
          </div>
        </div>
      </Section>
      <Section
        title={t("vault.map")}
        desc={<Html html={th("vault.mapHelp")} />}
        rows
        footer={
          <Footer message={message}>
            <button className={buttonClass("primary")} onClick={() => saveFolders(trimmed(map))}>
              {t("set.save")}
            </button>
          </Footer>
        }
      >
        {KEYS.map(mapping)}
      </Section>
      <VaultSyncSection />
      <ActionsSection ext="reminders" name={t("act.reminders")} />
      <Section title={t("set.sec.interface")} rows>
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
        <Field label={t("set.language")} id="language" hint={<Html html={th("set.languageHelp")} />}>
          <Select
            className={SELECT}
            id="language"
            options={languages}
            value={language || "system"}
            onChange={changeLanguage}
          />
        </Field>
        <Field label={t("set.faviconsOn")} id="favon" hint={<Html html={th("set.faviconsHelp")} />}>
          <Switch id="favon" on={faviconsOn} onToggle={saveFavicons} />
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
        <Field label={t("set.keepAwake")} id="awake" hint={<Html html={th("set.keepAwakeHelp")} />}>
          <Switch id="awake" on={keepAwake} onToggle={saveKeepAwake} />
        </Field>
        <Field label={t("set.autoRetry")} id="retry" hint={<Html html={th("set.autoRetryHelp")} />}>
          <Switch id="retry" on={autoRetry} onToggle={saveAutoRetry} />
        </Field>
        <Field label={t("set.timeFromSessions")} id="time" hint={<Html html={th("set.timeFromSessionsHelp")} />}>
          <Switch id="time" on={timeFromSessions} onToggle={saveTimeFromSessions} />
        </Field>
        <Field label={t("set.captureOnClose")} id="capture" hint={<Html html={th("set.captureOnCloseHelp")} />}>
          <Switch id="capture" on={captureOnClose} onToggle={saveCaptureOnClose} />
        </Field>
        <Field label={t("set.workerCrabs")} id="crabs" hint={<Html html={th("set.workerCrabsHelp")} />}>
          <Switch id="crabs" on={workerCrabs} onToggle={saveWorkerCrabs} />
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
      <PermissionsSection active={active} />
    </>
  );
}
