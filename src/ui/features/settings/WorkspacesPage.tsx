import { useEffect } from "react";
import type { Machine, SharedVault, TeamServer } from "../../../domain/settings/types";
import { vaultsByMachine } from "../../../domain/settings/machines";
import { showMachinesPage } from "../../../application/settings/machines-page";
import { useSettingsStore } from "../../../application/settings/store";
import { loadTeam } from "../../../application/settings/teams";
import { useT } from "../../hooks/useT";
import { ActionsSection } from "./ActionsSection";
import { MachineVaults, SharedVaults, TeamLogin, TeamVaults, WorkspacePage } from "./SharedVaults";

const NO_MACHINES: Machine[] = [];
const NO_VAULTS: SharedVault[] = [];
const NO_TEAMS: TeamServer[] = [];

/** Workspaces: every workspace of this Mac. The team servers first, each with this account's workspaces there, and
 *  Log in to a team server; then the personal ones joined with a link (an invite link that opened Relay shows its join
 *  form there), per machine the ones it keeps with New workspace on this machine…, and the knowledge workspaces' agent
 *  access. A workspace's row opens its page. The machines and team servers are read the first time the page shows. */
export function WorkspacesPage({ active }: { active: boolean }) {
  const { t } = useT();
  const machines = useSettingsStore(s => s.settings.machines ?? NO_MACHINES);
  const sharedVaults = useSettingsStore(s => s.settings.sharedVaults ?? NO_VAULTS);
  const teams = useSettingsStore(s => s.settings.teams ?? NO_TEAMS);
  const open = useSettingsStore(s => s.shared.open);
  useEffect(() => {
    if (!active) return;
    showMachinesPage();
    for (const team of teams) void loadTeam(team.fp);
  }, [active, teams]);
  const shown = sharedVaults.find(vault => vault.id === open);
  if (shown) return <WorkspacePage key={shown.id} vault={shown} />;
  const vaults = vaultsByMachine(
    machines,
    sharedVaults.filter(vault => !vault.team),
  );
  return (
    <>
      {teams.map(team => (
        <TeamVaults
          key={team.fp}
          team={team}
          vaults={sharedVaults.filter(vault => vault.team && vault.fp === team.fp)}
        />
      ))}
      <TeamLogin />
      <SharedVaults vaults={vaults.elsewhere} />
      {machines.map(machine => (
        <MachineVaults key={machine.id} machine={machine} vaults={vaults.on[machine.id]} />
      ))}
      <ActionsSection ext="knowledge" name={t("act.knowledge")} />
    </>
  );
}
