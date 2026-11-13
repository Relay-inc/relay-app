import type { SharedRole, SharedVault, TeamServer } from "../../../domain/settings/types";
import { adminsOf, orgDisplayName } from "../../../domain/settings/servers";
import { openOrgWorkspace } from "../../../application/settings/servers";
import { openForm } from "../../../application/settings/shared-vaults";
import { useSettingsStore } from "../../../application/settings/store";
import { syncTeamWorkspace } from "../../../application/settings/teams";
import { Icon } from "../../components/Icon";
import { useT } from "../../hooks/useT";
import { BUTTON_GLYPH, buttonClass } from "./blocks";
import { OrgNewWorkspace } from "./OrgNewWorkspace";
import { OrgWorkspace } from "./OrgWorkspace";
import { WorkspacePage } from "./SharedVaults";
import { StatusLine } from "./StatusLine";
import { TrustBadge } from "./TrustBadge";

const NO_VAULTS: SharedVault[] = [];
const TH = "px-2 pb-2 text-left text-xs font-normal text-s-muted";
const TD = "border-t border-s-border px-2 py-2.5 align-middle text-xs";

type Row = {
  id: string;
  name: string;
  nohistory: boolean;
  members: Record<string, SharedRole> | null; // null: a member does not see the others
  role: SharedRole | "";
  here: boolean;
};

/** Workspaces: every workspace of the organisation (an organisation admin) or yours (a member), with members, admins,
 *  your role and whether it syncs here; New workspace… opens in the page. A workspace synced here opens its page (the
 *  one Settings › Workspaces had), another its members. */
export function OrgWorkspaces({ team }: { team: TeamServer }) {
  const { t, tn } = useT();
  const o = useSettingsStore(s => s.team.overview[team.fp]);
  const me = useSettingsStore(s => s.team.me[team.fp]);
  const vaults = useSettingsStore(s => s.settings.sharedVaults ?? NO_VAULTS);
  const open = useSettingsStore(s => s.shared.open);
  const other = useSettingsStore(s => s.serversPage.workspace);
  const busy = useSettingsStore(s => !!s.shared.busy[`team:${team.fp}`]);
  const forming = useSettingsStore(s => s.shared.form.mode === "new" && s.shared.form.machine === `team:${team.fp}`);
  const synced = vaults.find(v => v.id === open && v.team && v.fp === team.fp);
  if (synced) return <WorkspacePage key={synced.id} vault={synced} />;
  if (other) return <OrgWorkspace key={other} team={team} id={other} />;
  const here = (id: string) => vaults.some(v => v.id === id);
  const mine = (id: string) => me?.workspaces.find(w => w.id === id)?.role ?? "";
  const rows: Row[] = o
    ? o.workspaces.map(w => ({ ...w, role: mine(w.id) || w.members[team.email] || "", here: here(w.id) }))
    : (me?.workspaces ?? []).map(w => ({ ...w, members: null, here: here(w.id) }));
  const roleKey = (role: string) =>
    role === "admin" ? "set.sharedAdmin" : role === "reader" ? "set.sharedReader" : "set.sharedMember";
  const who = (email: string) => (email === team.email ? t("srv.youCap") : email);
  return (
    <div className="grid min-w-0 gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex flex-1 flex-wrap items-center gap-2 text-xs text-s-muted">
          {t("srv.workspacesCount", { n: rows.length, in: rows.filter(r => r.role).length })}
          <TrustBadge kind="org" name={orgDisplayName(team)} />
        </span>
        <button className={buttonClass()} disabled={forming} onClick={() => openForm("new", `team:${team.fp}`)}>
          <Icon name="plus" className={BUTTON_GLYPH} />
          {t("set.teamNew")}
        </button>
      </div>
      {rows.length ? (
        <table className="w-full min-w-0 border-collapse">
          <thead>
            <tr>
              <th className={TH}>{t("srv.workspace")}</th>
              {o ? <th className={TH}>{t("srv.members")}</th> : null}
              {o ? <th className={TH}>{t("srv.admins")}</th> : null}
              <th className={TH}>{t("srv.youCap")}</th>
              <th className={TH}>{t("srv.onThisMac")}</th>
              <th className={TH}>
                <span className="sr-only">{t("srv.actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="hover:bg-s-hover">
                <td className={TD}>
                  <button className="grid min-w-0 gap-0.5 text-left" onClick={() => openOrgWorkspace(r.id)}>
                    <span className="truncate text-[13px] font-medium text-s-fg">{r.name}</span>
                    <span className="flex items-center gap-1 text-xs text-s-muted">
                      {r.nohistory ? <Icon name="bookmark" className="glyph size-3 stroke-2" /> : null}
                      {t(r.nohistory ? "srv.noHistoryLine" : "srv.historyLine")}
                    </span>
                  </button>
                </td>
                {r.members ? <td className={`${TD} text-s-fg tabular-nums`}>{Object.keys(r.members).length}</td> : null}
                {r.members ? (
                  <td className={`${TD} text-s-fg`}>
                    {adminsOf(r.members).map(who).join(", ")}
                    {adminsOf(r.members).length === 1 ? (
                      <span className="ml-1.5 text-s-warn">{t("srv.onlyAdmin")}</span>
                    ) : null}
                  </td>
                ) : null}
                <td className={`${TD} text-s-fg`}>{r.role ? t(roleKey(r.role)) : t("srv.notMember")}</td>
                <td className={TD}>
                  {r.here ? (
                    <StatusLine level="ok">{t("srv.synced")}</StatusLine>
                  ) : r.role ? (
                    <button
                      className={buttonClass()}
                      disabled={busy}
                      onClick={() => void syncTeamWorkspace(team.fp, r.id)}
                    >
                      {t("set.teamSyncHere")}
                    </button>
                  ) : (
                    <span className="text-s-muted">{t("srv.notHere")}</span>
                  )}
                </td>
                <td className={`${TD} text-right`}>
                  <button
                    className={buttonClass("ghost", true)}
                    aria-label={t("srv.openWorkspace", { name: r.name })}
                    onClick={() => openOrgWorkspace(r.id)}
                  >
                    <Icon name="right" className={BUTTON_GLYPH} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <span className="text-xs text-s-muted">{t("set.orgNoWorkspaces")}</span>
      )}
      {o && o.workspaces.length > rows.filter(r => r.role).length ? (
        <span className="text-xs text-s-muted">
          {tn("srv.seenAsAdmin", o.workspaces.length - rows.filter(r => r.role).length)}
        </span>
      ) : null}
      {forming ? <OrgNewWorkspace team={team} /> : null}
    </div>
  );
}
