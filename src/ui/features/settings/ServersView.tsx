import { useEffect } from "react";
import type { TeamServer } from "../../../domain/settings/types";
import { resolveItem } from "../../../domain/settings/servers";
import { showServers } from "../../../application/settings/servers";
import { useSettingsStore } from "../../../application/settings/store";
import { AddServerPane } from "./AddServerPane";
import { OrgDetail } from "./OrgDetail";
import { ServersList } from "./ServersList";

const NO_TEAMS: TeamServer[] = [];

/** Servers and organisations, in the middle column: this Mac, the machines and the organisations in a list on the
 *  left, the picked one on the right. Built from the settings window's pieces, so it takes their palette. */
export function ServersView({ className = "" }: { className?: string }) {
  const teams = useSettingsStore(s => s.settings.teams ?? NO_TEAMS);
  const item = useSettingsStore(s => resolveItem(s.serversPage.item, s.settings.teams ?? NO_TEAMS));
  useEffect(showServers, []);
  const team = teams.find(x => `org:${x.fp}` === item);
  return (
    <div className={`s-palette flex min-h-0 text-[13px] [line-height:1.4] ${className}`}>
      <ServersList item={item} />
      <section className="min-w-0 flex-1 overflow-y-auto">
        {team ? <OrgDetail key={team.fp} team={team} /> : <AddServerPane />}
      </section>
    </div>
  );
}
