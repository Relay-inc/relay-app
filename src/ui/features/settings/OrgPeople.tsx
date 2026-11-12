import { useState } from "react";
import type { SharedRole, TeamServer } from "../../../domain/settings/types";
import { orgDisplayName, workspacesOf } from "../../../domain/settings/servers";
import { showInvite } from "../../../application/settings/servers";
import { useSettingsStore } from "../../../application/settings/store";
import { renewTeamInvite, setTeamAccount, withdrawTeamInvite } from "../../../application/settings/teams";
import { sentAt } from "../../../shared/format";
import { Icon } from "../../components/Icon";
import { useT } from "../../hooks/useT";
import { BUTTON_GLYPH, buttonClass, FIELD, PILL } from "./blocks";
import { CopyButton } from "./CopyButton";
import { TrustBadge } from "./TrustBadge";

const TH = "px-2 pb-2 text-left text-xs font-normal text-s-muted";
const TD = "border-t border-s-border px-2 py-2 align-middle";

/** A workspace's letter in a person's row: solid for admin, filled for member, outlined for reader. */
export function RoleSquare({ name, role }: { name: string; role: SharedRole | "" }) {
  const look =
    role === "admin"
      ? "bg-s-fg text-s-bg border-s-fg"
      : role === "member"
        ? "bg-s-mutedbg text-s-fg border-s-input"
        : role === "reader"
          ? "bg-transparent text-s-fg border-s-input"
          : "border-transparent text-transparent";
  return (
    <span
      className={`grid size-5 flex-none place-items-center rounded-[4px] border text-[10px] font-semibold ${look}`}
      title={role ? `${name}: ${role}` : undefined}
    >
      {role ? name.slice(0, 1).toUpperCase() : "·"}
    </span>
  );
}

/** People: every account with its organisation role, its devices and its workspaces, the open invites above them, and
 *  the actions the server has: make an organisation admin or not, turn off or on, withdraw an invite or replace it with
 *  a new link (the server never gives an open invite's link again). */
export function OrgPeople({ team }: { team: TeamServer }) {
  const { t, tn, locale } = useT();
  const o = useSettingsStore(s => s.team.overview[team.fp]);
  const busy = useSettingsStore(s => !!s.shared.busy[`team:${team.fp}`]);
  const links = useSettingsStore(s => s.team.links);
  const [filter, setFilter] = useState("");
  if (!o) return <span className="text-xs text-s-muted">{t("set.sharedAsking")}</span>;
  const off = o.accounts.filter(a => a.off).length;
  const devices = o.accounts.reduce((sum, a) => sum + a.devices, 0);
  const shown = o.accounts.filter(a => a.email.includes(filter.trim().toLowerCase()));
  const roleKey = (role: string) =>
    role === "admin" ? "set.sharedAdmin" : role === "reader" ? "set.sharedReader" : "set.sharedMember";
  return (
    <div className="grid min-w-0 gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex-1 text-xs text-s-muted">
          {t("srv.peopleCount", { n: o.accounts.length, active: o.accounts.length - off, off, devices })}
        </span>
        <input
          className={`${FIELD} w-52`}
          type="search"
          aria-label={t("srv.filterPeople")}
          placeholder={t("srv.filterPeople")}
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
        <button className={buttonClass("primary")} onClick={() => showInvite(true)}>
          <Icon name="plus" className={BUTTON_GLYPH} />
          {t("srv.invitePeople")}
        </button>
      </div>

      {o.invites.map(i => {
        const admin = o.accounts.find(a => a.email === i.email)?.admin;
        const spaces = workspacesOf(o, i.email)
          .map(w => t("srv.inviteAs", { name: w.name, role: t(roleKey(w.role)).toLowerCase() }))
          .join(", ");
        return (
          <div
            key={i.id}
            className="flex min-w-0 flex-wrap items-center gap-2.5 rounded-xl border border-s-border bg-raised px-3.5 py-2.5"
          >
            <Icon name="mail" className="glyph size-4 flex-none stroke-[1.5] text-s-warn" />
            <span className="min-w-0 flex-1 text-xs text-s-fg">
              <b className="font-medium">{t("srv.openInvite")}</b> · {i.email} ·{" "}
              {t(admin ? "set.orgAdmin" : "srv.member")}
              {spaces ? ` · ${spaces}` : ""} · {t("srv.until", { time: sentAt(i.expires * 1000, locale) })}
              {links[i.id] ? (
                <span className="block truncate font-mono text-[11px] text-s-muted">{links[i.id]}</span>
              ) : null}
            </span>
            {links[i.id] ? (
              <CopyButton label={t("mc.copy")} text={links[i.id]} />
            ) : (
              <button
                className={buttonClass()}
                disabled={busy}
                title={t("srv.newLinkTip")}
                onClick={() => void renewTeamInvite(team.fp, i)}
              >
                {t("srv.newLink")}
              </button>
            )}
            <button className={buttonClass()} disabled={busy} onClick={() => void withdrawTeamInvite(team.fp, i.id)}>
              {t("set.sharedWithdraw")}
            </button>
          </div>
        );
      })}

      <table className="w-full min-w-0 border-collapse">
        <thead>
          <tr>
            <th className={TH}>{t("srv.person")}</th>
            <th className={TH}>{t("srv.orgRole")}</th>
            <th className={TH}>{t("srv.devices")}</th>
            <th className={TH}>{t("srv.tabWorkspaces")}</th>
            <th className={TH}>
              <span className="sr-only">{t("srv.actions")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {shown.map(a => (
            <tr key={a.email} className="group hover:bg-s-hover">
              <td className={TD}>
                <span className={`text-xs ${a.off ? "text-s-muted line-through" : "text-s-fg"}`}>{a.email}</span>
                {a.email === team.email ? <span className={`${PILL} ml-2`}>{t("srv.youTag")}</span> : null}
              </td>
              <td className={TD}>
                <span className={a.off || a.admin ? PILL : "text-xs text-s-fg"}>
                  {t(a.off ? "srv.turnedOff" : a.admin ? "set.orgAdmin" : "srv.member")}
                </span>
              </td>
              <td className={`${TD} text-xs text-s-fg tabular-nums`}>
                <span title={tn("set.orgDevices", a.devices)} className="inline-flex items-center gap-1">
                  <Icon name="laptop" className="glyph size-3.5 stroke-[1.5] text-s-muted" />
                  {a.devices}
                </span>
              </td>
              <td className={TD}>
                <span className="flex gap-1">
                  {o.workspaces.map(w => (
                    <RoleSquare key={w.id} name={w.name} role={w.members[a.email] ?? ""} />
                  ))}
                </span>
              </td>
              <td className={`${TD} text-right`}>
                {a.email === team.email ? null : (
                  <span className="inline-flex gap-1.5 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
                    {a.off ? null : (
                      <button
                        className={buttonClass("ghost")}
                        disabled={busy}
                        onClick={() => void setTeamAccount(team.fp, a.email, { admin: !a.admin })}
                      >
                        {t(a.admin ? "set.orgUnmakeAdmin" : "set.orgMakeAdmin")}
                      </button>
                    )}
                    <button
                      className={buttonClass(a.off ? "plain" : "danger")}
                      disabled={busy}
                      title={a.off ? undefined : tn("srv.turnOffTip", a.devices)}
                      onClick={() => void setTeamAccount(team.fp, a.email, { off: !a.off })}
                    >
                      {t(a.off ? "set.orgTurnOn" : "set.orgTurnOff")}
                    </button>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-s-muted">
        <span className="inline-flex items-center gap-1.5">
          <RoleSquare name="A" role="admin" />
          {t("set.sharedAdmin")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <RoleSquare name="M" role="member" />
          {t("set.sharedMember")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <RoleSquare name="R" role="reader" />
          {t("set.sharedReader")}
        </span>
        <span className="min-w-0 flex-1 truncate">{o.workspaces.map(w => w.name).join(" · ")}</span>
        <TrustBadge kind="org" name={orgDisplayName(team)} />
      </div>
    </div>
  );
}
