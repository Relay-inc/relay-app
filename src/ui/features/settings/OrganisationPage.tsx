import { useEffect, useState } from "react";
import type { TeamServer, TeamSso } from "../../../domain/settings/types";
import { ENTRA, GOOGLE_ISSUER } from "../../../domain/settings/types";
import { useSettingsStore } from "../../../application/settings/store";
import {
  inviteTeam,
  loadTeam,
  setTeamAccount,
  setTeamSso,
  teamLink,
  withdrawTeamInvite,
} from "../../../application/settings/teams";
import { sentAt } from "../../../shared/format";
import { useT } from "../../hooks/useT";
import { buttonClass, ERROR_MESSAGE, FIELD, HINT_IN_ROW, PILL, SELECT } from "./blocks";
import { Field } from "./Field";
import { CommandBlock } from "./MachineSetup";
import { Section } from "./Section";

const NO_TEAMS: TeamServer[] = [];
const LABEL = "text-xs font-medium text-s-fg";

/** Organisation: per team server this Mac's account is an organisation admin of (docs/workspaces.md, Teams), its
 *  accounts (organisation admin, turned off), its workspaces, open invites, the sign-in and the server's link. */
export function OrganisationPage({ active }: { active: boolean }) {
  const teams = useSettingsStore(s => s.settings.teams ?? NO_TEAMS);
  useEffect(() => {
    if (active) for (const team of teams) if (team.admin) void loadTeam(team.fp);
  }, [active, teams]);
  return teams.filter(team => team.admin).map(team => <TeamOrganisation key={team.fp} team={team} />);
}

function TeamOrganisation({ team }: { team: TeamServer }) {
  const { t, tn, locale } = useT();
  const o = useSettingsStore(s => s.team.overview[team.fp]);
  const busy = useSettingsStore(s => !!s.shared.busy[`team:${team.fp}`]);
  const message = useSettingsStore(s => s.shared.messages[`team:${team.fp}`]);
  const [email, setEmail] = useState("");
  const [admin, setAdmin] = useState(false);
  const [link, setLink] = useState({ email: "", link: "" });
  const [serverLink, setServerLink] = useState("");
  const until = (expires: number) => sentAt(expires * 1000, locale);
  return (
    <>
      <Section title={t("set.teamServer", { host: team.host, email: team.email })}>
        {message ? <span className={message.ok ? HINT_IN_ROW : ERROR_MESSAGE}>{message.text}</span> : null}
        {serverLink ? (
          <CommandBlock hint={t("set.orgServerLinkHelp")} command={serverLink} wrap />
        ) : (
          <div>
            <button className={buttonClass("ghost")} onClick={async () => setServerLink(await teamLink(team.fp))}>
              {t("set.orgServerLink")}
            </button>
          </div>
        )}
      </Section>

      <Section title={t("set.orgAccounts")}>
        {o ? (
          <div className="grid min-w-0 gap-1.5">
            {o.accounts.map(a => (
              <div key={a.email} className="flex min-h-7 flex-wrap items-center gap-2">
                <span className={`min-w-0 truncate text-xs ${a.off ? "text-s-muted line-through" : "text-s-fg"}`}>
                  {a.email}
                </span>
                <span className="text-xs text-s-muted">{tn("set.orgDevices", a.devices)}</span>
                {a.admin ? <span className={PILL}>{t("set.orgAdmin")}</span> : null}
                <span className="flex-1"></span>
                {a.email === team.email ? null : (
                  <>
                    <button
                      className={buttonClass("ghost")}
                      disabled={busy}
                      onClick={() => setTeamAccount(team.fp, a.email, { admin: !a.admin })}
                    >
                      {t(a.admin ? "set.orgUnmakeAdmin" : "set.orgMakeAdmin")}
                    </button>
                    <button
                      className={buttonClass(a.off ? "ghost" : "danger")}
                      disabled={busy}
                      onClick={() => setTeamAccount(team.fp, a.email, { off: !a.off })}
                    >
                      {t(a.off ? "set.orgTurnOn" : "set.orgTurnOff")}
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        ) : (
          <span className="text-xs text-s-muted">{t("set.sharedAsking")}</span>
        )}
        {link.link ? (
          <div className="grid gap-1.5">
            <span className={LABEL}>{t("set.teamInviteLink", { email: link.email })}</span>
            <CommandBlock hint={t("set.teamInviteLinkHelp")} command={link.link} wrap />
            <div>
              <button className={`${buttonClass("ghost")} -ml-3`} onClick={() => setLink({ email: "", link: "" })}>
                {t("set.sharedDone")}
              </button>
            </div>
          </div>
        ) : (
          <form
            className="flex min-w-0 flex-wrap items-center gap-2"
            onSubmit={async e => {
              e.preventDefault();
              const who = email.trim();
              const made = await inviteTeam(team.fp, who, "", "member", admin);
              if (made) {
                setLink({ email: who, link: made });
                setEmail("");
                setAdmin(false);
              }
            }}
          >
            <input
              className={`${FIELD} min-w-0 flex-1 basis-48`}
              type="email"
              aria-label={t("set.teamInviteEmail")}
              placeholder={t("set.teamInviteEmail")}
              value={email}
              onChange={e => setEmail(e.target.value)}
            />
            <label className="flex items-center gap-1.5 text-xs text-s-fg">
              <input type="checkbox" checked={admin} onChange={e => setAdmin(e.target.checked)} />
              {t("set.orgAdmin")}
            </label>
            <button type="submit" className={buttonClass("primary")} disabled={busy || !email.includes("@")}>
              {t("set.sharedInvite")}
            </button>
          </form>
        )}
        {o?.invites.length ? (
          <div className="grid min-w-0 gap-1.5">
            <span className={LABEL}>{t("set.sharedInvites")}</span>
            {o.invites.map(i => (
              <div key={i.id} className="flex min-h-7 items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-xs text-s-muted">
                  {t("set.orgInviteOpen", { email: i.email, time: until(i.expires) })}
                </span>
                <button
                  className={buttonClass("ghost")}
                  disabled={busy}
                  onClick={() => withdrawTeamInvite(team.fp, i.id)}
                >
                  {t("set.sharedWithdraw")}
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </Section>

      <Section title={t("set.orgWorkspaces")}>
        {o?.workspaces.length ? (
          <div className="grid min-w-0 gap-1">
            {o.workspaces.map(w => (
              <div key={w.id} className="flex min-h-7 items-center gap-2">
                <span className="min-w-0 truncate text-xs text-s-fg">{w.name}</span>
                {w.nohistory ? <span className={PILL}>{t("set.sharedNoHistoryLabel")}</span> : null}
                <span className="flex-1"></span>
                <span className="truncate text-xs text-s-muted" title={Object.keys(w.members).join(", ")}>
                  {tn("set.orgMembers", Object.keys(w.members).length)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <span className="text-xs text-s-muted">{t("set.orgNoWorkspaces")}</span>
        )}
      </Section>

      {o ? <SsoSection team={team} sso={o.sso} busy={busy} /> : null}
    </>
  );
}

type Provider = "" | "google" | "entra";
const providerOf = (sso: TeamSso | null): Provider => (!sso ? "" : sso.issuer.startsWith(ENTRA) ? "entra" : "google");

/** The sign-in besides invite links: Google (a client id and the email domains) or one Entra tenant (its id and the
 *  app registration's client id), or none. */
function SsoSection({ team, sso, busy }: { team: TeamServer; sso: TeamSso | null; busy: boolean }) {
  const { t } = useT();
  const [provider, setProvider] = useState<Provider>(providerOf(sso));
  const [client, setClient] = useState(sso?.client ?? "");
  const [tenant, setTenant] = useState(sso?.issuer.startsWith(ENTRA) ? sso.issuer.slice(ENTRA.length, -5) : "");
  const [domains, setDomains] = useState(sso?.domains.join(", ") ?? "");
  const save = () =>
    setTeamSso(
      team.fp,
      provider === ""
        ? null
        : provider === "entra"
          ? { issuer: `${ENTRA}${tenant.trim().toLowerCase()}/v2.0`, client: client.trim(), domains: [] }
          : {
              issuer: GOOGLE_ISSUER,
              client: client.trim(),
              domains: domains
                .split(",")
                .map(d => d.trim().toLowerCase())
                .filter(Boolean),
            },
    );
  return (
    <Section title={t("set.orgSso")} desc={t("set.orgSsoHelp")}>
      <Field label={t("set.ssoProvider")} id={`sso-${team.fp}`}>
        <select
          id={`sso-${team.fp}`}
          className={SELECT}
          value={provider}
          onChange={e => setProvider(e.target.value as Provider)}
        >
          <option value="">{t("set.orgSsoNone")}</option>
          <option value="google">Google</option>
          <option value="entra">{t("set.ssoEntra")}</option>
        </select>
      </Field>
      {provider === "entra" ? (
        <Field label={t("set.ssoTenant")} hint={t("set.ssoTenantHelp")} id={`tenant-${team.fp}`}>
          <input id={`tenant-${team.fp}`} className={FIELD} value={tenant} onChange={e => setTenant(e.target.value)} />
        </Field>
      ) : null}
      {provider ? (
        <Field
          label={t("set.ssoClient")}
          hint={t(provider === "entra" ? "set.ssoClientHelpEntra" : "set.ssoClientHelp")}
          id={`client-${team.fp}`}
        >
          <input id={`client-${team.fp}`} className={FIELD} value={client} onChange={e => setClient(e.target.value)} />
        </Field>
      ) : null}
      {provider === "google" ? (
        <Field label={t("set.ssoDomains")} hint={t("set.orgSsoDomainsHelp")} id={`domains-${team.fp}`}>
          <input
            id={`domains-${team.fp}`}
            className={FIELD}
            placeholder="example.com"
            value={domains}
            onChange={e => setDomains(e.target.value)}
          />
        </Field>
      ) : null}
      <div>
        <button className={buttonClass("primary")} disabled={busy} onClick={() => void save()}>
          {t("set.ssoSave")}
        </button>
      </div>
    </Section>
  );
}
