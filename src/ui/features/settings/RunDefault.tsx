import { useState } from "react";
import type { Machine } from "../../../domain/settings/types";
import { setRunDefault } from "../../../application/settings/machines-page";
import { useSettingsStore } from "../../../application/settings/store";
import { useT } from "../../hooks/useT";
import { ERROR_MESSAGE, SELECT } from "./blocks";
import { Field } from "./Field";
import { Section } from "./Section";

const NO_MACHINES: Machine[] = [];

/** Where new conversations run: this Mac or a machine of your own (not one for workspaces only). Nothing without such
 *  a machine. */
export function RunDefault() {
  const { t } = useT();
  const machines = useSettingsStore(s => s.settings.machines ?? NO_MACHINES);
  const runDefault = useSettingsStore(s => s.settings.machines_default ?? "");
  const [error, setError] = useState("");
  const runners = machines.filter(machine => !machine.sharedOnly);
  if (!runners.length) return null;
  return (
    <Section title={t("mc.runDefaultTitle")}>
      <Field label={t("mc.runDefault")} hint={t("mc.runDefaultHelp")} id="mcdefault">
        <select
          className={SELECT}
          id="mcdefault"
          value={runDefault}
          onChange={async e => setError(await setRunDefault(e.target.value))}
        >
          <option value="">{t("composer.thisMac")}</option>
          {runners.map(machine => (
            <option key={machine.id} value={machine.id}>
              {machine.name}
            </option>
          ))}
        </select>
      </Field>
      {error ? <span className={ERROR_MESSAGE}>{error}</span> : null}
    </Section>
  );
}
