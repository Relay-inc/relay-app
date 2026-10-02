import { useState } from "react";
import type { Key } from "../../../shared/i18n";
import { KEYS, type MapKey, type VaultMap, type VaultStatus } from "../../../domain/workspace/types";
import type { Theme } from "../../../domain/settings/types";
import { useSettingsStore } from "../../../application/settings/store";
import {
  changeLanguage,
  changeTheme,
  checkMap,
  pickMappedFile,
  pickVaultFolder,
  saveFavicons,
  saveFolders,
} from "../../../application/settings/general-page";
import { Html } from "../../components/Html";
import { Select } from "../../components/Select";
import { useT } from "../../hooks/useT";
import { buttonClass, OPTIONAL_TEXT, SELECT, withoutColon } from "./blocks";
import { Field } from "./Field";
import { Footer } from "./Footer";
import { PathField } from "./PathField";
import { Section } from "./Section";
import { Switch } from "./Switch";

const trimmed = (map: VaultMap) => Object.fromEntries(KEYS.map(([key]) => [key, map[key].trim()])) as VaultMap;

/** General: the vault folder with its mapping, and the interface (language, colour scheme, favicons). */
export function GeneralPage({ vaultStatus }: { vaultStatus: VaultStatus }) {
  const { t, th } = useT();
  const language = useSettingsStore(s => s.settings.language);
  const theme = useSettingsStore(s => s.settings.theme);
  const faviconsOn = useSettingsStore(s => s.settings.favicons?.on !== false);
  const message = useSettingsStore(s => s.message);
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
    { id: "system", name: t("set.system") },
    { id: "light", name: t("set.themeLight") },
    { id: "dark", name: t("set.themeDark") },
  ];
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
      <Section
        title={t("set.sec.folders")}
        desc={<Html html={th("vault.mapHelp")} />}
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
      <Section title={t("set.sec.interface")}>
        <Field label={t("set.language")} id="language" hint={<Html html={th("set.languageHelp")} />}>
          <Select
            className={SELECT}
            id="language"
            options={languages}
            value={language || "system"}
            onChange={changeLanguage}
          />
        </Field>
        <Field label={t("set.theme")} id="theme" hint={<Html html={th("set.themeHelp")} />}>
          <Select
            className={SELECT}
            id="theme"
            options={themes}
            value={theme || "system"}
            onChange={value => changeTheme(value as Theme)}
          />
        </Field>
        <Field label={t("set.faviconsOn")} id="favon" hint={<Html html={th("set.faviconsHelp")} />}>
          <Switch id="favon" on={faviconsOn} onToggle={saveFavicons} />
        </Field>
      </Section>
    </>
  );
}
