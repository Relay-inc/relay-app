import { useEffect } from "react";
import type { Machine } from "../../../domain/settings/types";
import { orgMachines } from "../../../domain/settings/machines";
import { showMachinesPage } from "../../../application/settings/machines-page";
import { useSettingsStore } from "../../../application/settings/store";
import { useT } from "../../hooks/useT";
import { MachineOrganisation } from "./MachineOrganisation";
import { Section } from "./Section";
import { StatusLine } from "./StatusLine";

const NO_MACHINES: Machine[] = [];

/** Organisation: per server this Mac is fully paired with, its organisation (docs/workspaces.md, Organisation), closed
 *  until asked as opening it publishes this Mac's organisation keys there. The machines are checked the first time
 *  the page shows, as on Machines. */
export function OrganisationPage({ active }: { active: boolean }) {
  const { t } = useT();
  const machines = orgMachines(useSettingsStore(s => s.settings.machines ?? NO_MACHINES));
  const status = useSettingsStore(s => s.machinesPage.status);
  useEffect(() => {
    if (active) showMachinesPage();
  }, [active]);
  return machines.map(machine => {
    const state = status[machine.id];
    return (
      <Section key={machine.id} title={machine.name}>
        {!state || state === "checking" ? (
          <StatusLine level="off">{t("mc.checking")}</StatusLine>
        ) : state.ok ? (
          <MachineOrganisation machine={machine} />
        ) : (
          <StatusLine level="warn">{t("mc.offline")}</StatusLine>
        )}
      </Section>
    );
  });
}
