import { useEffect } from "react";
import type { Machine, SharedVault } from "../../../domain/settings/types";
import { vaultsByMachine } from "../../../domain/settings/machines";
import { watchMachines } from "../../../application/settings/servers";
import { checkMachine } from "../../../application/settings/machines-page";
import { useSettingsStore } from "../../../application/settings/store";
import { Icon } from "../../components/Icon";
import { useT } from "../../hooks/useT";
import { buttonClass } from "./blocks";
import { MachineRow } from "./MachineRow";
import { MachineVaults } from "./SharedVaults";
import { TrustBadge } from "./TrustBadge";

const NO_MACHINES: Machine[] = [];
const NO_VAULTS: SharedVault[] = [];

/** A machine of your own on Organisations and servers: what Settings › Machines had for it (online, update, phone,
 *  Forget, its mirror, GitHub and repos) and the encrypted workspaces it keeps, with New workspace on this machine…. */
export function MachineDetail({ machine }: { machine: Machine }) {
  const { t } = useT();
  const machines = useSettingsStore(s => s.settings.machines ?? NO_MACHINES);
  const vaults = useSettingsStore(s => s.settings.sharedVaults ?? NO_VAULTS);
  useEffect(watchMachines, []);
  const on = vaultsByMachine(
    machines,
    vaults.filter(v => !v.team),
  ).on[machine.id];
  return (
    <div className="mx-auto grid max-w-200 min-w-0 grid-cols-1 gap-7 px-8 pt-6 pb-10 [&>*]:min-w-0">
      <header className="flex items-start gap-3.5">
        <span className="grid size-11 flex-none place-items-center rounded-xl bg-trust-e2e/12 text-trust-e2e">
          <Icon name="server" className="glyph size-5.5 stroke-[1.5]" />
        </span>
        <div className="grid min-w-0 flex-1 gap-1">
          <h1 className="truncate text-xl font-semibold text-s-fg">{machine.name}</h1>
          <div className="flex flex-wrap items-center gap-2.5 text-xs text-s-muted">
            <TrustBadge kind="e2e" />
            <span>{t(machine.sharedOnly ? "srv.machineSharedOnly" : "srv.machineOwn")}</span>
          </div>
        </div>
        <button className={buttonClass("ghost")} onClick={() => checkMachine(machine.id)}>
          {t("mc.refresh")}
        </button>
      </header>
      <div className="grid min-w-0 rounded-xl border border-s-border bg-raised">
        <MachineRow machine={machine} />
      </div>
      <MachineVaults machine={machine} vaults={on} />
    </div>
  );
}
