import { useState } from "react";
import type { SharedRole, TeamServer } from "../../../domain/settings/types";
import { orgDisplayName, parseEmails } from "../../../domain/settings/servers";
import { inviteMany, showInvite, type Invited } from "../../../application/settings/servers";
import { useSettingsStore } from "../../../application/settings/store";
import { sentAt } from "../../../shared/format";
import { Icon } from "../../components/Icon";
import { useT } from "../../hooks/useT";
import { AREA, buttonClass, ERROR_MESSAGE, HINT, SELECT } from "./blocks";
import { CopyButton } from "./CopyButton";
import { Segmented } from "./Segmented";
import { TrustBadge } from "./TrustBadge";

const LABEL = "pt-1 text-[13px] font-medium text-s-fg";

/** Invite people, a sheet over People in two steps: the addresses, their organisation role and a role per workspace,
 *  then a link per new address to send yourself (Relay sends no mail). An address that has an account is only added. */
export function OrgInvite({ team }: { team: TeamServer }) {
  const { t, tn, locale } = useT();
  const o = useSettingsStore(s => s.team.overview[team.fp]);
  const busy = useSettingsStore(s => !!s.shared.busy[`team:${team.fp}`]);
  const [text, setText] = useState("");
  const [admin, setAdmin] = useState(false);
  const [roles, setRoles] = useState<Record<string, SharedRole>>({});
  const [done, setDone] = useState<Invited[] | null>(null);
  if (!o) return null;
  const name = orgDisplayName(team);
  const { good, bad } = parseEmails(text);
  const existing = good.filter(e => o.accounts.some(a => a.email === e));
  const fresh = good.filter(e => !existing.includes(e));
  const roleOptions: [SharedRole, string][] = [
    ["member", t("set.sharedMember")],
    ["reader", t("set.sharedReader")],
    ["admin", t("set.sharedAdmin")],
  ];
  const close = () => showInvite(false);
  return (
    <div
      className="s-palette fixed inset-0 z-50 grid place-items-center bg-[rgba(10,10,14,.32)]"
      onClick={e => e.target === e.currentTarget && close()}
    >
      <div
        role="dialog"
        aria-label={t("srv.inviteTitle", { name })}
        className="grid max-h-[calc(100vh-48px)] w-180 max-w-[calc(100vw-48px)] grid-rows-[auto_1fr_auto] overflow-hidden rounded-[14px] bg-s-bg shadow-xl"
      >
        {done ? (
          <>
            <header className="grid gap-1 px-6 pt-5 pb-3">
              <h2 className="flex items-center gap-2 text-base font-semibold text-s-fg">
                <Icon name="check" className="glyph size-4 stroke-2 text-s-ok" />
                {tn("srv.inviteDone", done.filter(d => d.link).length, {
                  added: done.filter(d => !d.link && !d.error).length,
                })}
              </h2>
              <p className={HINT}>{t("srv.inviteDoneHelp")}</p>
            </header>
            <div className="grid content-start overflow-y-auto px-6">
              {done.map(d => (
                <div key={d.email} className="flex min-w-0 items-center gap-3 border-t border-s-border py-2.5">
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="truncate text-xs text-s-fg">{d.email}</span>
                    {d.error ? (
                      <span className={ERROR_MESSAGE}>{d.error}</span>
                    ) : d.link ? (
                      <span className="truncate font-mono text-[11px] text-s-muted">{d.link}</span>
                    ) : (
                      <span className="text-xs text-s-muted">{t("srv.inviteAdded")}</span>
                    )}
                  </span>
                  {d.link ? <CopyButton label={t("mc.copy")} text={d.link} /> : null}
                </div>
              ))}
              <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2 border-t border-s-border py-3 text-xs">
                {done.some(d => d.expires) ? (
                  <>
                    <dt className="text-s-muted">{t("srv.validUntil")}</dt>
                    <dd className="text-s-fg">
                      {sentAt(Math.min(...done.filter(d => d.expires).map(d => d.expires)) * 1000, locale)}
                    </dd>
                  </>
                ) : null}
                <dt className="text-s-muted">{t("srv.onTheirMac")}</dt>
                <dd className="text-s-fg">{t("srv.onTheirMacHelp", { name })}</dd>
                <dt className="text-s-muted">{t("srv.ifExpires")}</dt>
                <dd className="text-s-fg">{t("srv.ifExpiresHelp")}</dd>
              </dl>
            </div>
            <footer className="flex items-center gap-3 border-t border-s-border px-6 py-3">
              <span className="flex-1 text-xs text-s-muted">{t("srv.invitesStay")}</span>
              <button className={buttonClass("primary")} onClick={close}>
                {t("set.sharedDone")}
              </button>
            </footer>
          </>
        ) : (
          <>
            <header className="grid gap-1 px-6 pt-5 pb-3">
              <h2 className="text-base font-semibold text-s-fg">{t("srv.inviteTitle", { name })}</h2>
              <p className={HINT}>{t("srv.inviteHelp")}</p>
            </header>
            <div className="grid content-start gap-5 overflow-y-auto px-6 pb-5 sm:grid-cols-[9rem_1fr]">
              <label htmlFor="invite-emails" className={LABEL}>
                {t("srv.emails")}
              </label>
              <div className="grid gap-1">
                <textarea
                  id="invite-emails"
                  className={`${AREA} w-full font-sans text-[13px]`}
                  rows={3}
                  spellCheck={false}
                  placeholder="name@example.com"
                  value={text}
                  onChange={e => setText(e.target.value)}
                />
                <span className={HINT}>
                  {t("srv.emailsHelp")}
                  {existing.length ? ` ${t("srv.emailsExisting", { emails: existing.join(", ") })}` : ""}
                </span>
                {bad.length ? (
                  <span className={ERROR_MESSAGE}>{t("srv.emailsBad", { emails: bad.join(", ") })}</span>
                ) : null}
              </div>

              <span className={LABEL}>{t("srv.inOrg")}</span>
              <div className="grid justify-items-start gap-1">
                <Segmented
                  label={t("srv.inOrg")}
                  options={[
                    ["member", t("srv.member")],
                    ["admin", t("set.orgAdmin")],
                  ]}
                  value={admin ? "admin" : "member"}
                  onPick={v => setAdmin(v === "admin")}
                />
                <span className={HINT}>{t("srv.orgAdminHelp")}</span>
              </div>

              <span className={LABEL}>{t("srv.tabWorkspaces")}</span>
              <div className="grid gap-1">
                {o.workspaces.map(w => {
                  const on = w.id in roles;
                  return (
                    <div key={w.id} className="flex min-w-0 items-center gap-2.5 border-b border-s-border py-1.5">
                      <input
                        id={`invite-${w.id}`}
                        type="checkbox"
                        checked={on}
                        onChange={e =>
                          setRoles(prev => {
                            const next = { ...prev };
                            if (e.target.checked) next[w.id] = "member";
                            else delete next[w.id];
                            return next;
                          })
                        }
                      />
                      <label htmlFor={`invite-${w.id}`} className="min-w-0 flex-1 truncate text-xs text-s-fg">
                        {w.name}
                      </label>
                      <select
                        className={`${SELECT} w-32`}
                        aria-label={t("set.sharedRoleOf", { name: w.name })}
                        disabled={!on}
                        value={roles[w.id] ?? "member"}
                        onChange={e => setRoles(prev => ({ ...prev, [w.id]: e.target.value as SharedRole }))}
                      >
                        {roleOptions.map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
                {!o.workspaces.length ? <span className={HINT}>{t("set.orgNoWorkspaces")}</span> : null}
                <span className={HINT}>{t("srv.rolesHelp")}</span>
              </div>

              {good.length ? (
                <>
                  <span className={LABEL}>{t("srv.whatTheyGet")}</span>
                  <ul className="grid list-disc gap-1 rounded-lg bg-s-mutedbg/50 py-2.5 pr-3 pl-7 text-xs text-s-fg">
                    {fresh.length ? <li>{t("srv.getNew", { emails: fresh.join(", ") })}</li> : null}
                    {existing.length ? <li>{t("srv.getExisting", { emails: existing.join(", ") })}</li> : null}
                    {Object.keys(roles).length ? (
                      <li>
                        {t("srv.getWorkspaces", {
                          list: o.workspaces
                            .filter(w => w.id in roles)
                            .map(w =>
                              t("srv.inviteAs", {
                                name: w.name,
                                role: roleOptions.find(r => r[0] === roles[w.id])![1].toLowerCase(),
                              }),
                            )
                            .join(", "),
                        })}
                      </li>
                    ) : null}
                    {o.sso ? <li>{t("srv.getNextDevices")}</li> : null}
                  </ul>
                </>
              ) : null}
            </div>
            <footer className="flex flex-wrap items-center gap-3 border-t border-s-border px-6 py-3">
              <span className="flex flex-1 items-center gap-2 text-xs text-s-muted">
                <TrustBadge kind="org" name={name} />
                {t("srv.noMail")}
              </span>
              <button className={buttonClass("ghost")} onClick={close}>
                {t("mc.cancel")}
              </button>
              <button
                className={buttonClass("primary")}
                disabled={busy || !good.length || !!bad.length}
                onClick={async () => {
                  setDone(await inviteMany(team.fp, good, admin, roles));
                }}
              >
                {fresh.length ? tn("srv.createLinks", fresh.length) : t("srv.addPeople")}
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
