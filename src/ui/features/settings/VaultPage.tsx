import { useState } from "react";
import type { Key } from "../../../shared/i18n";
import { KEYS, type MapKey, type VaultMap, type VaultStatus } from "../../../domain/workspace/types";
import { useSettingsStore } from "../../../application/settings/store";
import {
  addExtraVault,
  checkMap,
  pickMappedFile,
  pickVaultFolder,
  removeExtraVault,
  saveFolders,
} from "../../../application/settings/general-page";
import { Html } from "../../components/Html";
import { useT } from "../../hooks/useT";
import { buttonClass, OPTIONAL_TEXT, withoutColon } from "./blocks";
import { Field } from "./Field";
import { Footer } from "./Footer";
import { PathField } from "./PathField";
import { Section } from "./Section";
import { VaultSyncSection } from "./VaultSyncSection";

const NONE: string[] = [];
const trimmed = (map: VaultMap) => Object.fromEntries(KEYS.map(([key]) => [key, map[key].trim()])) as VaultMap;

/** Vault: the vault folder, the other folders on this Mac, the files Relay reads in the vault (its mapping) and the
 *  vault's git backup. */
export function VaultPage({ vaultStatus }: { vaultStatus: VaultStatus }) {
  const { t, th } = useT();
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
        hint={t(`set.vaultH.${key}` as Key)}
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
      <Section title={t("set.extraVaultsTitle")} desc={t("set.extraVaultsHelp")} info={t("set.extraVaultsInfo")}>
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
        title={t("set.vaultMap")}
        desc={t("set.vaultMapHelp")}
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
    </>
  );
}
