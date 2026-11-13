import { useState } from "react";
import type { SharedRole, TeamServer } from "../../../domain/settings/types";
import { orgDisplayName } from "../../../domain/settings/servers";
import { closeOrgWorkspace, openOrgWorkspace } from "../../../application/settings/servers";
import { useSettingsStore } from "../../../application/settings/store";
import { inviteTeam, loadTeam, setTeamMember, syncTeamWorkspace } from "../../../application/settings/teams";
import { Icon } from "../../components/Icon";
import { useT } from "../../hooks/useT";
import { BUTTON_GLYPH, buttonClass, ERROR_MESSAGE, FIELD, HINT, SELECT } from "./blocks";
import { CommandBlock } from "./MachineSetup";
import { Section } from "./Section";
import { TrustBadge } from "./TrustBadge";

/** A workspace of the organisation that does not sync to this Mac: its history (fixed), and for an organisation admin
 *  its members with their role, an address to add, taking someone out. A member of it can sync it here. */
export function OrgWorkspace({ team, id }: { team: TeamServer; id: string }) {
  const { t } = useT();
  const o = useSettingsStore(s => s.team.overview[team.fp]);
  const me = useSettingsStore(s => s.team.me[team.fp]);
  const busy = useSettingsStore(s => !!s.shared.busy[`team:${team.fp}`] || !!s.shared.busy[id]);
  const message = useSettingsStore(s => s.shared.messages[id]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<SharedRole>("member");
  const [link, setLink] = useState({ email: "", link: "" });
  const w = o?.workspaces.find(x => x.id === id) ?? me?.workspaces.find(x => x.id === id);
  if (!w) return null;
  const members = o?.workspaces.find(x => x.id === id)?.members;
  const mine = me?.workspaces.find(x => x.id === id)?.role;
  const roles: [SharedRole, string][] = [
    ["member", t("set.sharedMember")],
    ["reader", t("set.sharedReader")],
    ["admin", t("set.sharedAdmin")],
  ];
  const after = () => loadTeam(team.fp);
  return (
    <div className="grid min-w-0 gap-5">
      <header className="grid gap-2">
        <button className={`${buttonClass("ghost")} -ml-2 justify-self-start`} onClick={closeOrgWorkspace}>
          <Icon name="left" className={BUTTON_GLYPH} />
          {t("srv.tabWorkspaces")}
        </button>
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="text-base font-semibold text-s-fg">{w.name}</h2>
          <TrustBadge kind="org" name={orgDisplayName(team)} />
          {mine ? null : <span className="text-xs text-s-muted">{t("srv.notMemberSees")}</span>}
        </div>
        {message && !message.ok ? <span className={ERROR_MESSAGE}>{message.text}</span> : null}
      </header>
      <div className="grid min-w-0 grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        {members ? (
          <Section title={t("set.sharedMembers")}>
            <div className="grid min-w-0 gap-1.5">
              {Object.entries(members).map(([who, r]) => (
                <div key={who} className="flex min-h-7 items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-xs text-s-fg">
                    {who}
                    {who === team.email ? <span className="text-s-muted"> · {t("set.teamYou")}</span> : null}
                  </span>
                  <select
                    className={`${SELECT} w-32`}
                    aria-label={t("set.sharedRoleOf", { name: who })}
                    disabled={busy}
                    value={r}
                    onChange={async e => {
                      await setTeamMember(team.fp, id, who, e.target.value as SharedRole);
                      await after();
                    }}
                  >
                    {roles.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <button
                    className={buttonClass("ghost")}
                    disabled={busy}
                    aria-label={t("set.extraVaultRemove", { name: who })}
                    onClick={async () => {
                      await setTeamMember(team.fp, id, who, "");
                      await after();
                    }}
                  >
                    {t("ag.remove")}
                  </button>
                </div>
              ))}
            </div>
            {link.link ? (
              <div className="grid gap-1.5">
                <CommandBlock hint={t("set.teamInviteLink", { email: link.email })} command={link.link} wrap />
                <button
                  className={`${buttonClass("ghost")} -ml-3 justify-self-start`}
                  onClick={() => setLink({ email: "", link: "" })}
                >
                  {t("set.sharedDone")}
                </button>
              </div>
            ) : (
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <input
                  className={`${FIELD} min-w-0 flex-1 basis-48`}
                  type="email"
                  aria-label={t("set.teamInviteEmail")}
                  placeholder={t("set.teamInviteEmail")}
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                />
                <select
                  className={`${SELECT} w-32`}
                  aria-label={t("set.sharedInviteAs")}
                  value={role}
                  onChange={e => setRole(e.target.value as SharedRole)}
                >
                  {roles.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <button
                  className={buttonClass("primary")}
                  disabled={busy || !email.includes("@")}
                  onClick={async () => {
                    const who = email.trim().toLowerCase();
                    // an account that is there is only added: an organisation admin's invite would make it a link
                    if (o?.accounts.some(a => a.email === who)) {
                      if (await setTeamMember(team.fp, id, who, role)) setEmail("");
                    } else {
                      const made = await inviteTeam(team.fp, who, id, role);
                      if (made !== null) {
                        setEmail("");
                        if (made) setLink({ email: who, link: made });
                      }
                    }
                    await after();
                  }}
                >
                  {t("srv.addMember")}
                </button>
              </div>
            )}
            <span className={HINT}>{t("set.teamInviteHelp")}</span>
          </Section>
        ) : (
          <Section title={t("set.sharedMembers")}>
            <span className="text-xs text-s-muted">{t("srv.membersAdminsOnly")}</span>
          </Section>
        )}
        <div className="grid min-w-0 gap-5">
          <Section title={t(w.nohistory ? "srv.historyOff" : "srv.historyOn")}>
            <span className="text-xs text-s-muted">{t(w.nohistory ? "srv.historyOffHelp" : "srv.historyOnHelp")}</span>
          </Section>
          <Section title={t("srv.onThisMac")}>
            {mine ? (
              <div className="flex items-center gap-3">
                <span className="flex-1 text-xs text-s-muted">{t("srv.notSyncedHere")}</span>
                <button
                  className={buttonClass()}
                  disabled={busy}
                  onClick={async () => {
                    await syncTeamWorkspace(team.fp, id);
                    // synced now: its page, the one a synced workspace has
                    openOrgWorkspace(id);
                  }}
                >
                  {t("set.teamSyncHere")}
                </button>
              </div>
            ) : (
              <span className="text-xs text-s-muted">{t("srv.notMemberHere")}</span>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
