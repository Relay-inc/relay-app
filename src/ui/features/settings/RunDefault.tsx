import { useState } from "react";
import type { Machine } from "../../../domain/settings/types";
import { setRunDefault } from "../../../application/settings/machines-page";
import { useSettingsStore } from "../../../application/settings/store";
import { Select } from "../../components/Select";
import { useT } from "../../hooks/useT";
import { ERROR_MESSAGE, SELECT } from "./blocks";

const NO_MACHINES: Machine[] = [];

/** "on [where]" in the Agents bar: where new conversations run, this Mac or a machine of your own (not one for
 *  workspaces only). Nothing without such a machine. */
export function RunDefault() {
  const { t } = useT();
  const machines = useSettingsStore(s => s.settings.machines ?? NO_MACHINES);
  const runDefault = useSettingsStore(s => s.settings.machines_default ?? "");
  const [error, setError] = useState("");
  const runners = machines.filter(machine => !machine.sharedOnly);
  if (!runners.length) return null;
  return (
    <>
      <span>{t("ag.runsOn")}</span>
      <Select
        className={SELECT}
        aria-label={t("mc.runDefault")}
        empty={t("composer.thisMac")}
        options={runners.map(machine => ({ id: machine.id, name: machine.name }))}
        value={runDefault}
        onChange={async value => setError(await setRunDefault(value))}
      />
      {error ? <span className={ERROR_MESSAGE}>{error}</span> : null}
    </>
  );
}
