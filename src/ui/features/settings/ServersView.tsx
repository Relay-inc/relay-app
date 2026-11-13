import { useEffect } from "react";
import type { Machine, SharedVault, TeamServer } from "../../../domain/settings/types";
import { resolveItem } from "../../../domain/settings/servers";
import { showServers } from "../../../application/settings/servers";
import { useSettingsStore } from "../../../application/settings/store";
import { AddServer } from "./AddServer";
import { MacDetail } from "./MacDetail";
import { MachineDetail } from "./MachineDetail";
import { OrgDetail } from "./OrgDetail";
import { ServersList } from "./ServersList";
import { WorkspacePage } from "./SharedVaults";

const NO_TEAMS: TeamServer[] = [];
const NO_MACHINES: Machine[] = [];
const NO_VAULTS: SharedVault[] = [];

/** Servers and organisations, in the middle column: this Mac, the machines and the organisations in a list on the
 *  left, the picked one on the right, or Add a server. An encrypted workspace's page opens over the right side (from
 *  This Mac or a machine). Built from the settings window's pieces, so it takes their palette. */
export function ServersView({ className = "" }: { className?: string }) {
  const teams = useSettingsStore(s => s.settings.teams ?? NO_TEAMS);
  const machines = useSettingsStore(s => s.settings.machines ?? NO_MACHINES);
  const vaults = useSettingsStore(s => s.settings.sharedVaults ?? NO_VAULTS);
  const open = useSettingsStore(s => s.shared.open);
  const item = useSettingsStore(s =>
    resolveItem(
      s.serversPage.item,
      s.settings.teams ?? NO_TEAMS,
      s.settings.machines ?? NO_MACHINES,
      !!s.serversPage.draft,
    ),
  );
  useEffect(showServers, []);
  const team = teams.find(x => `org:${x.fp}` === item);
  const machine = machines.find(x => `machine:${x.id}` === item);
  const vault = vaults.find(v => v.id === open && !v.team);
  return (
    <div className={`s-palette flex min-h-0 text-[13px] [line-height:1.4] ${className}`}>
      <ServersList item={item} />
      <section className="min-w-0 flex-1 overflow-y-auto">
        {vault ? (
          <div className="mx-auto grid max-w-170 min-w-0 grid-cols-1 gap-7 px-8 pt-6 pb-10 [&>*]:min-w-0">
            <WorkspacePage key={vault.id} vault={vault} />
          </div>
        ) : team ? (
          <OrgDetail key={team.fp} team={team} />
        ) : machine ? (
          <MachineDetail key={machine.id} machine={machine} />
        ) : item === "mac" ? (
          <MacDetail />
        ) : (
          <AddServer setup={item === "setup"} />
        )}
      </section>
    </div>
  );
}
