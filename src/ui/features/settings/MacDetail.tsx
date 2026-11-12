import type { Machine, SharedVault } from "../../../domain/settings/types";
import { vaultsByMachine } from "../../../domain/settings/machines";
import { useSettingsStore } from "../../../application/settings/store";
import { Icon } from "../../components/Icon";
import { useT } from "../../hooks/useT";
import { HINT } from "./blocks";
import { MachineHost } from "./MachineHost";
import { SharedVaults } from "./SharedVaults";

const NO_MACHINES: Machine[] = [];
const NO_VAULTS: SharedVault[] = [];

/** This Mac on Servers and organisations: this Mac as a machine for another Mac (Relay's own relay-server), and the
 *  encrypted workspaces it joined with a link on a server that is not one of its machines. */
export function MacDetail() {
  const { t } = useT();
  const machines = useSettingsStore(s => s.settings.machines ?? NO_MACHINES);
  const vaults = useSettingsStore(s => s.settings.sharedVaults ?? NO_VAULTS);
  const elsewhere = vaultsByMachine(
    machines,
    vaults.filter(v => !v.team),
  ).elsewhere;
  return (
    <div className="mx-auto grid max-w-170 min-w-0 grid-cols-1 gap-7 px-8 pt-6 pb-10 [&>*]:min-w-0">
      <header className="flex items-start gap-3.5">
        <span className="grid size-11 flex-none place-items-center rounded-xl bg-s-mutedbg text-s-muted">
          <Icon name="laptop" className="glyph size-5.5 stroke-[1.5]" />
        </span>
        <div className="grid gap-1">
          <h1 className="text-xl font-semibold text-s-fg">{t("srv.thisMac")}</h1>
          <p className={HINT}>{t("srv.thisMacHelp")}</p>
        </div>
      </header>
      <MachineHost />
      <SharedVaults vaults={elsewhere} />
    </div>
  );
}
