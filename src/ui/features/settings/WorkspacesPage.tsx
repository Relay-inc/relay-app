import { useEffect } from "react";
import type { Machine, SharedVault } from "../../../domain/settings/types";
import { vaultsByMachine } from "../../../domain/settings/machines";
import { showMachinesPage } from "../../../application/settings/machines-page";
import { useSettingsStore } from "../../../application/settings/store";
import { openServersPage } from "../../../application/settings/window";
import { useT } from "../../hooks/useT";
import { ActionsSection } from "./ActionsSection";
import { buttonClass } from "./blocks";
import { Section } from "./Section";
import { MachineVaults, SharedVaults, WorkspacePage } from "./SharedVaults";

const NO_MACHINES: Machine[] = [];
const NO_VAULTS: SharedVault[] = [];

/** Workspaces: the personal workspaces of this Mac, joined with a link (an invite link that opened Relay shows its join
 *  form there) and per machine the ones it keeps with New workspace on this machine…, then the knowledge workspaces'
 *  agent access. A workspace's row opens its page. Organisations (team servers) are on Servers and organisations, a
 *  row says so. The machines are read the first time the page shows. */
export function WorkspacesPage({ active }: { active: boolean }) {
  const { t } = useT();
  const machines = useSettingsStore(s => s.settings.machines ?? NO_MACHINES);
  const sharedVaults = useSettingsStore(s => s.settings.sharedVaults ?? NO_VAULTS);
  const open = useSettingsStore(s => s.shared.open);
  useEffect(() => {
    if (active) showMachinesPage();
  }, [active]);
  const shown = sharedVaults.find(vault => vault.id === open && !vault.team);
  if (shown) return <WorkspacePage key={shown.id} vault={shown} />;
  const vaults = vaultsByMachine(
    machines,
    sharedVaults.filter(vault => !vault.team),
  );
  return (
    <>
      <Section
        title={t("srv.orgsInSettings")}
        desc={t("srv.orgsInSettingsHelp")}
        action={
          <button className={buttonClass()} onClick={() => void openServersPage()}>
            {t("srv.open")}
          </button>
        }
      />
      <SharedVaults vaults={vaults.elsewhere} />
      {machines.map(machine => (
        <MachineVaults key={machine.id} machine={machine} vaults={vaults.on[machine.id]} />
      ))}
      <ActionsSection ext="knowledge" name={t("act.knowledge")} />
    </>
  );
}
