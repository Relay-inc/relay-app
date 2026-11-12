import { cleanOrgName, nameClash } from "../../../domain/settings/servers";
import { useSettingsStore } from "../../../application/settings/store";
import { peekTeam } from "../../../application/settings/teams";
import { Icon } from "../../components/Icon";
import { useT } from "../../hooks/useT";
import { buttonClass } from "./blocks";

/** Before logging in to an organisation's server: the server as the link names it (its address and certificate), and
 *  Check this server, which asks it the name it gives itself. Relay contacts the server only on that click. The name is
 *  a claim, never the identity: it shows as "calls itself", and a name another organisation here already has is said. */
export function ServerClaim({ link, host, fp }: { link: string; host: string; fp: string }) {
  const { t } = useT();
  const peek = useSettingsStore(s => (s.team.peek?.link === link ? s.team.peek : null));
  const teams = useSettingsStore(s => s.settings.teams);
  const name = cleanOrgName(peek?.name);
  const clash = nameClash(teams, fp, name);
  return (
    <div className="grid gap-1.5">
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className="font-mono text-s-fg">{host}</span>
        <span className="font-mono text-s-muted" title={fp}>
          {t("srv.certificate", { fp: fp.slice(0, 16) })}
        </span>
        {peek ? (
          <span className="text-s-muted">{name ? t("srv.callsItself", { name }) : t("srv.noNameGiven")}</span>
        ) : (
          <button className={buttonClass("ghost")} onClick={() => void peekTeam(link)}>
            {t("srv.checkServer")}
          </button>
        )}
      </span>
      {clash ? (
        <span className="flex items-start gap-1.5 text-xs text-s-warn">
          <Icon name="alert" className="glyph mt-px size-3.5 flex-none stroke-2" />
          {t("srv.nameClash", { name, host: clash.host })}
        </span>
      ) : null}
    </div>
  );
}
