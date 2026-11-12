import { useState } from "react";
import type { TeamServer } from "../../../domain/settings/types";
import { orgDisplayName } from "../../../domain/settings/servers";
import { useSettingsStore } from "../../../application/settings/store";
import { logoutTeam } from "../../../application/settings/teams";
import { useT } from "../../hooks/useT";
import { buttonClass } from "./blocks";

/** Sign this Mac out of an organisation: its session ends there, its workspaces stop syncing here and their folders
 *  stay. Asks once. */
export function OrgSignOut({ team }: { team: TeamServer }) {
  const { t } = useT();
  const busy = useSettingsStore(s => !!s.shared.busy[`team:${team.fp}`]);
  const [sure, setSure] = useState(false);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-3 rounded-xl border border-s-border bg-raised px-3.5 py-3">
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="text-xs font-medium text-s-fg">{t("srv.signOut", { name: orgDisplayName(team) })}</span>
        <span className="text-xs text-s-muted">{t("srv.signOutHelp")}</span>
      </span>
      {sure ? (
        <>
          <button className={buttonClass("ghost")} onClick={() => setSure(false)}>
            {t("mc.cancel")}
          </button>
          <button className={buttonClass("dangerSolid")} disabled={busy} onClick={() => void logoutTeam(team.fp)}>
            {t("set.teamLogout")}
          </button>
        </>
      ) : (
        <button className={buttonClass("danger")} onClick={() => setSure(true)}>
          {t("srv.signOutButton")}
        </button>
      )}
    </div>
  );
}
