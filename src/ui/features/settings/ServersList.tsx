import type { ReactNode } from "react";
import type { Machine, TeamServer } from "../../../domain/settings/types";
import { orgDisplayName } from "../../../domain/settings/servers";
import { openSettingsPage, pickServer } from "../../../application/settings/servers";
import { useSettingsStore } from "../../../application/settings/store";
import { Icon } from "../../components/Icon";
import { useT } from "../../hooks/useT";

const NO_MACHINES: Machine[] = [];
const NO_TEAMS: TeamServer[] = [];
const GROUP = "px-2.5 pt-4 pb-1.5 text-[11px] font-semibold tracking-wider text-s-faint uppercase";

/** The page's list: This Mac, Your machines, Organisations, and Add a server last. This Mac and a machine open
 *  Settings › Machines, where they are set up today. */
export function ServersList({ item }: { item: string }) {
  const { t } = useT();
  const machines = useSettingsStore(s => s.settings.machines ?? NO_MACHINES);
  const teams = useSettingsStore(s => s.settings.teams ?? NO_TEAMS);
  const status = useSettingsStore(s => s.machinesPage.status);
  const host = useSettingsStore(s => s.machinesPage.host);
  return (
    <nav aria-label={t("nav.servers")} className="flex w-65 flex-none flex-col border-r border-s-seam px-2 select-none">
      <h2 className="px-2.5 pt-5 text-[15px] font-semibold text-s-fg">{t("srv.servers")}</h2>
      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        <div className={GROUP}>{t("srv.thisMac")}</div>
        <Row
          icon="laptop"
          name={t("srv.thisMac")}
          sub={host ? t(host.on ? "srv.asMachineOn" : "srv.asMachineOff") : ""}
          onClick={() => openSettingsPage("machines")}
        />
        <div className={GROUP}>{t("srv.yourMachines")}</div>
        {machines.length ? (
          machines.map(machine => {
            const s = status[machine.id];
            return (
              <Row
                key={machine.id}
                icon="server"
                name={machine.name}
                sub={
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className={`size-1.5 rounded-full ${s === "checking" || !s ? "bg-s-muted/50" : s.ok ? "bg-s-ok" : "bg-s-muted"}`}
                    />
                    {t(s === "checking" || !s ? "srv.checking" : s.ok ? "srv.online" : "srv.offline")}
                  </span>
                }
                onClick={() => openSettingsPage("machines")}
              />
            );
          })
        ) : (
          <p className="px-2.5 py-1 text-xs text-s-faint">{t("srv.noMachines")}</p>
        )}
        <div className={GROUP}>{t("srv.organisations")}</div>
        {teams.length ? (
          teams.map(team => (
            <Row
              key={team.fp}
              icon="building"
              name={orgDisplayName(team)}
              sub={t(team.admin ? "set.orgAdmin" : "srv.member")}
              picked={item === `org:${team.fp}`}
              onClick={() => pickServer(`org:${team.fp}`)}
            />
          ))
        ) : (
          <p className="px-2.5 py-1 text-xs text-s-faint">{t("srv.noOrgs")}</p>
        )}
      </div>
      <div className="border-t border-s-seam py-2">
        <button
          className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-accent-text hover:bg-s-hover ${item === "add" ? "bg-s-sel" : ""}`}
          aria-current={item === "add" ? "page" : undefined}
          onClick={() => pickServer("add")}
        >
          <Icon name="plus" className="glyph size-4 flex-none stroke-2" />
          {t("srv.add")}
        </button>
      </div>
    </nav>
  );
}

function Row({
  icon,
  name,
  sub,
  picked = false,
  onClick,
}: {
  icon: string;
  name: string;
  sub: ReactNode;
  picked?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-1.5 text-left hover:bg-s-hover ${picked ? "bg-s-mutedbg" : ""}`}
      aria-current={picked ? "page" : undefined}
      onClick={onClick}
    >
      <Icon name={icon} className="glyph mt-px size-4 flex-none stroke-[1.5] text-s-muted" />
      <span className="grid min-w-0 flex-1">
        <span className="truncate text-[13px] text-s-fg">{name}</span>
        {sub ? <span className="truncate text-xs text-s-muted">{sub}</span> : null}
      </span>
    </button>
  );
}
