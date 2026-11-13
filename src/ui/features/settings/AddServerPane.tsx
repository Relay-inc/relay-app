import { openSettingsPage } from "../../../application/settings/servers";
import { useT } from "../../hooks/useT";
import { buttonClass, HINT } from "./blocks";
import { Section } from "./Section";
import { TeamLogin } from "./SharedVaults";

/** Add a server: log in to an organisation's server with the link it printed or an admin sent, or set up and pair a
 *  machine of your own (Settings › Machines). */
export function AddServerPane() {
  const { t } = useT();
  return (
    <div className="mx-auto grid max-w-170 min-w-0 gap-7 px-8 pt-6 pb-10">
      <header className="grid gap-1">
        <h1 className="text-xl font-semibold text-s-fg">{t("srv.add")}</h1>
        <p className={HINT}>{t("srv.addHelp")}</p>
      </header>
      <TeamLogin />
      <Section
        title={t("srv.ownMachine")}
        desc={t("srv.ownMachineHelp")}
        action={
          <button className={buttonClass()} onClick={() => openSettingsPage("machines")}>
            {t("srv.openMachines")}
          </button>
        }
      />
    </div>
  );
}
