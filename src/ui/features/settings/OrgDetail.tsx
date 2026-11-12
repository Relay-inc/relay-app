import type { TeamServer } from "../../../domain/settings/types";
import { orgDisplayName, orgTabs } from "../../../domain/settings/servers";
import { orgTabName, pickOrgTab } from "../../../application/settings/servers";
import { useSettingsStore } from "../../../application/settings/store";
import { teamLink } from "../../../application/settings/teams";
import { Icon } from "../../components/Icon";
import { useT } from "../../hooks/useT";
import { ERROR_MESSAGE } from "./blocks";
import { CopyButton } from "./CopyButton";
import { OrgInvite } from "./OrgInvite";
import { OrgOverview } from "./OrgOverview";
import { OrgPeople } from "./OrgPeople";
import { OrgServer } from "./OrgServer";
import { OrgSignIn } from "./OrgSignIn";
import { OrgWorkspaces } from "./OrgWorkspaces";
import { TrustBadge } from "./TrustBadge";

/** An organisation on Servers and organisations: its name, host, who can read and your role, then its tabs. An
 *  organisation admin has Overview, People, Workspaces, Sign-in and Server, a member Overview and Workspaces. */
export function OrgDetail({ team }: { team: TeamServer }) {
  const { t } = useT();
  const picked = useSettingsStore(s => s.serversPage.tab);
  const inviting = useSettingsStore(s => s.serversPage.inviting);
  const overview = useSettingsStore(s => s.team.overview[team.fp]);
  const message = useSettingsStore(s => s.shared.messages[`team:${team.fp}`]);
  const tabs = orgTabs(team.admin);
  const tab = tabs.includes(picked) ? picked : "overview";
  const name = orgDisplayName(team);
  const count = (id: typeof tab) =>
    id === "people" ? overview?.accounts.length : id === "workspaces" ? overview?.workspaces.length : undefined;
  return (
    <div className="mx-auto grid max-w-240 min-w-0 gap-5 px-8 pt-6 pb-10">
      <header className="flex min-w-0 items-start gap-3.5">
        <span className="grid size-11 flex-none place-items-center rounded-xl bg-trust-org/12 text-trust-org">
          <Icon name="building" className="glyph size-5.5 stroke-[1.5]" />
        </span>
        <div className="grid min-w-0 flex-1 gap-1">
          <h1 className="truncate text-xl font-semibold text-s-fg">{name}</h1>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-s-muted">
            {name !== team.host ? <span className="font-mono">{team.host}</span> : null}
            <TrustBadge kind="org" name={name} />
            <span>
              {team.email} · {t(team.admin ? "set.orgAdmin" : "srv.member")}
            </span>
          </div>
        </div>
        <CopyButton label={t("srv.copySignInLink")} get={() => teamLink(team.fp)} />
      </header>
      {message && !message.ok ? <span className={ERROR_MESSAGE}>{message.text}</span> : null}
      <div role="tablist" className="flex gap-5 border-b border-s-seam">
        {tabs.map(id => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={`-mb-px border-b-2 pb-2 text-[13px] ${tab === id ? "border-s-fg font-medium text-s-fg" : "border-transparent text-s-muted hover:text-s-fg"}`}
            onClick={() => pickOrgTab(id)}
          >
            {orgTabName(id)}
            {count(id) !== undefined ? <span className="ml-1.5 text-xs text-s-faint">{count(id)}</span> : null}
          </button>
        ))}
      </div>
      {tab === "overview" ? (
        <OrgOverview team={team} />
      ) : tab === "people" ? (
        <OrgPeople team={team} />
      ) : tab === "workspaces" ? (
        <OrgWorkspaces team={team} />
      ) : tab === "signin" ? (
        <OrgSignIn key={overview ? "read" : "asking"} team={team} />
      ) : (
        <OrgServer team={team} />
      )}
      {inviting && team.admin ? <OrgInvite team={team} /> : null}
    </div>
  );
}
