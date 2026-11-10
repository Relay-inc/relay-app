import { useEffect } from "react";
import type { Machine, SharedVault } from "../../../domain/settings/types";
import { vaultsByMachine } from "../../../domain/settings/machines";
import { showMachinesPage } from "../../../application/settings/machines-page";
import { useSettingsStore } from "../../../application/settings/store";
import { useT } from "../../hooks/useT";
import { ActionsSection } from "./ActionsSection";
import { MachineVaults, SharedVaults, WorkspacePage } from "./SharedVaults";

const NO_MACHINES: Machine[] = [];
const NO_VAULTS: SharedVault[] = [];

/** Workspaces: every workspace of this Mac, the ones joined with a link first (an invite link that opened Relay shows
 *  its join form there without scrolling), then per machine the ones it keeps with New workspace on this machine…, and
 *  the knowledge workspaces' agent access. A workspace's row opens its page. The machines are checked the first time
 *  the page shows, as on Machines. */
export function WorkspacesPage({ active }: { active: boolean }) {
  const { t } = useT();
  const machines = useSettingsStore(s => s.settings.machines ?? NO_MACHINES);
  const sharedVaults = useSettingsStore(s => s.settings.sharedVaults ?? NO_VAULTS);
  const open = useSettingsStore(s => s.shared.open);
  useEffect(() => {
    if (active) showMachinesPage();
  }, [active]);
  const shown = sharedVaults.find(vault => vault.id === open);
  if (shown) return <WorkspacePage key={shown.id} vault={shown} />;
  const vaults = vaultsByMachine(machines, sharedVaults);
  return (
    <>
      <SharedVaults vaults={vaults.elsewhere} />
      {machines.map(machine => (
        <MachineVaults key={machine.id} machine={machine} vaults={vaults.on[machine.id]} />
      ))}
      <ActionsSection ext="knowledge" name={t("act.knowledge")} />
    </>
  );
}
