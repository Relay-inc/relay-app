import type { ReactNode } from "react";
import type { TeamOverview, TeamServer } from "../../../domain/settings/types";
import { ENTRA } from "../../../domain/settings/types";
import { orgDisplayName, setupChecklist, type SetupItem } from "../../../domain/settings/servers";
import { openOrgWorkspace, pickOrgTab } from "../../../application/settings/servers";
import { useSettingsStore } from "../../../application/settings/store";
import { renewTeamInvite, syncTeamWorkspace, teamLink } from "../../../application/settings/teams";
import { openForm } from "../../../application/settings/shared-vaults";
import { sentAt } from "../../../shared/format";
import { Icon } from "../../components/Icon";
import { useT } from "../../hooks/useT";
import { buttonClass, PILL } from "./blocks";
import { CopyButton } from "./CopyButton";
import { OrgSignOut } from "./OrgSignOut";
import { StatusLine } from "./StatusLine";

const CARD = "grid min-w-0 rounded-xl border border-s-border bg-raised";
const ROW =
  "grid min-w-0 grid-cols-[8rem_1fr] items-center gap-3 border-t border-s-border px-3.5 py-2.5 first:border-t-0";
const H2 = "text-[13px] font-semibold text-s-fg";
const KEY = "text-xs text-s-muted";
const LINK = "inline-flex items-center gap-1 text-xs text-accent-text hover:underline";

/** An organisation's Overview. For its admins: how many people, invites and workspaces (each to its tab), the server,
 *  the sign-in link, your account and what is still to set up, as far as the server says. For a member: your
 *  workspaces, your account, the organisation and who can read. */
export function OrgOverview({ team }: { team: TeamServer }) {
  const overview = useSettingsStore(s => s.team.overview[team.fp]);
  if (!team.admin) return <MemberOverview team={team} />;
  return (
    <div className="grid min-w-0 gap-5">
      {overview ? <Counters team={team} o={overview} /> : null}
      <div className="grid min-w-0 grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="grid min-w-0 gap-5">
          <ServerCard team={team} />
          <SignInLink team={team} o={overview} />
          <You team={team} o={overview} />
        </div>
        {overview ? <Setup team={team} o={overview} /> : null}
      </div>
    </div>
  );
}

function Counters({ team, o }: { team: TeamServer; o: TeamOverview }) {
  const { t, locale } = useT();
  const off = o.accounts.filter(a => a.off).length;
  const mine = useSettingsStore(s => s.team.me[team.fp]?.workspaces);
  const firstExpiry = Math.min(...o.invites.map(i => i.expires));
  const cell = (n: number, text: string, link: string, onClick: () => void) => (
    <div className="grid gap-1 border-l border-s-border px-4 py-3 first:border-l-0">
      <span className="text-xl font-semibold text-s-fg tabular-nums">{n}</span>
      <span className="text-xs text-s-muted">{text}</span>
      <button className={`${LINK} justify-self-start`} onClick={onClick}>
        {link}
        <Icon name="right" className="glyph size-3 stroke-2" />
      </button>
    </div>
  );
  return (
    <div className={`${CARD} grid-cols-3`}>
      {cell(
        o.accounts.length,
        t("srv.countAccounts", { active: o.accounts.length - off, off }),
        t("srv.tabPeople"),
        () => pickOrgTab("people"),
      )}
      {cell(
        o.invites.length,
        o.invites.length
          ? t("srv.countInvites", { time: sentAt(firstExpiry * 1000, locale) })
          : t("srv.countNoInvites"),
        t("srv.tabPeople"),
        () => pickOrgTab("people"),
      )}
      {cell(
        o.workspaces.length,
        t("srv.countWorkspaces", {
          in: mine?.length ?? 0,
          admin: mine?.filter(w => w.role === "admin").length ?? 0,
        }),
        t("srv.tabWorkspaces"),
        () => pickOrgTab("workspaces"),
      )}
    </div>
  );
}

/** The server as this Mac sees it: reached or not, its address, and what kind of server it is. */
export function ServerStatus({ team }: { team: TeamServer }) {
  const { t } = useT();
  const me = useSettingsStore(s => s.team.me[team.fp]);
  const busy = useSettingsStore(s => !!s.shared.busy[`team:${team.fp}`]);
  const message = useSettingsStore(s => s.shared.messages[`team:${team.fp}`]);
  if (message && !message.ok) return <StatusLine level="warn">{t("srv.unreachable")}</StatusLine>;
  if (!me || busy) return <StatusLine level="off">{t("srv.checking")}</StatusLine>;
  return <StatusLine level="ok">{t("srv.connected")}</StatusLine>;
}

function ServerCard({ team }: { team: TeamServer }) {
  const { t } = useT();
  return (
    <section className="grid gap-2.5">
      <h2 className={H2}>{t("srv.server")}</h2>
      <div className={CARD}>
        <div className={ROW}>
          <span className={KEY}>{t("srv.status")}</span>
          <ServerStatus team={team} />
        </div>
        <div className={ROW}>
          <span className={KEY}>{t("srv.address")}</span>
          <span className="min-w-0 truncate text-xs text-s-fg">
            <span className="font-mono">{team.host}</span>
            <span className="text-s-muted"> {t("srv.port", { port: team.port })}</span>
          </span>
        </div>
        <div className={ROW}>
          <span className={KEY}>{t("srv.kind")}</span>
          <span className="grid gap-0.5">
            <span className="text-xs text-s-fg">{t("srv.kindOrg")}</span>
            <span className="text-xs text-s-muted">{t("srv.kindOrgHelp")}</span>
          </span>
        </div>
        <div className={ROW}>
          <span className={KEY}>{t("srv.version")}</span>
          <button className={`${LINK} justify-self-start`} onClick={() => pickOrgTab("server")}>
            {t("srv.versionRule")}
            <Icon name="right" className="glyph size-3 stroke-2" />
          </button>
        </div>
      </div>
    </section>
  );
}

function providerName(o: TeamOverview | null | undefined) {
  if (!o?.sso) return "";
  return o.sso.issuer.startsWith(ENTRA) ? "Microsoft Entra" : "Google";
}

function SignInLink({ team, o }: { team: TeamServer; o: TeamOverview | null | undefined }) {
  const { t } = useT();
  const provider = providerName(o);
  return (
    <section className="grid gap-2.5">
      <h2 className={H2}>{t("srv.signInLink")}</h2>
      <div className={`${CARD} gap-2 px-3.5 py-3`}>
        <div className="flex items-start gap-3">
          <span className="flex-1 text-xs text-s-fg">
            {provider ? t("srv.signInLinkHelp", { provider }) : t("srv.signInLinkNoProvider")}
          </span>
          <CopyButton label={t("srv.copySignInLink")} get={() => teamLink(team.fp)} />
        </div>
        <span className="text-xs text-s-muted">{t("srv.signInLinkNew")}</span>
      </div>
    </section>
  );
}

function You({ team, o }: { team: TeamServer; o: TeamOverview | null | undefined }) {
  const { t, tn } = useT();
  const devices = o?.accounts.find(a => a.email === team.email)?.devices;
  return (
    <section className="grid gap-2.5">
      <h2 className={H2}>{t("srv.you")}</h2>
      <div className={CARD}>
        <div className={ROW}>
          <span className={KEY}>{t("srv.account")}</span>
          <span className="truncate text-xs text-s-fg">
            {team.email} · {t(team.admin ? "set.orgAdmin" : "srv.member")}
          </span>
        </div>
        {devices !== undefined ? (
          <div className={ROW}>
            <span className={KEY}>{t("srv.signedInOn")}</span>
            <span className="text-xs text-s-fg">{tn("set.orgDevices", devices)}</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** What is still to set up, from the overview only: a second organisation admin, a sign-in besides invite links,
 *  workspaces with one admin, invites nobody used. */
function Setup({ team, o }: { team: TeamServer; o: TeamOverview }) {
  const { t, tn, locale } = useT();
  const busy = useSettingsStore(s => !!s.shared.busy[`team:${team.fp}`]);
  const links = useSettingsStore(s => s.team.links);
  const items = setupChecklist(o);
  const done = items.filter(i => i.done).length;
  const who = (email: string) => (email === team.email ? t("srv.youLower") : email);
  const line = (item: SetupItem): [string, string, ReactNode] => {
    switch (item.kind) {
      case "admins":
        return item.done
          ? [t("srv.setupAdmins"), item.admins.filter(a => a !== team.email).join(", "), null]
          : [
              t("srv.setupAdmins"),
              t("srv.setupAdminsOpen"),
              <button key="go" className={buttonClass()} onClick={() => pickOrgTab("people")}>
                {t("srv.tabPeople")}
              </button>,
            ];
      case "signin":
        return [
          item.done ? t("srv.setupSignInDone", { provider: providerName(o) }) : t("srv.setupSignIn"),
          item.done ? (o.sso?.domains.join(", ") ?? "") : t("srv.setupSignInOpen"),
          <button key="go" className={buttonClass(item.done ? "ghost" : "plain")} onClick={() => pickOrgTab("signin")}>
            {t("srv.tabSignin")}
          </button>,
        ];
      case "alone":
        return [
          tn("srv.setupAlone", item.workspaces.length),
          `${item.workspaces.map(w => t("srv.setupAloneOne", { name: w.name, who: who(w.admin) })).join(", ")}. ${t("srv.setupAloneHelp")}`,
          <button
            key="go"
            className={buttonClass()}
            onClick={() =>
              item.workspaces.length === 1 ? openOrgWorkspace(item.workspaces[0].id) : pickOrgTab("workspaces")
            }
          >
            {t("srv.addAdmin")}
          </button>,
        ];
      case "invite":
        return [
          t("srv.setupInvite", { email: item.email }),
          links[item.id] ?? t("srv.setupInviteHelp", { time: sentAt(item.expires * 1000, locale) }),
          links[item.id] ? (
            <CopyButton key="go" label={t("mc.copy")} text={links[item.id]} />
          ) : (
            <button
              key="go"
              className={buttonClass()}
              disabled={busy}
              title={t("srv.newLinkTip")}
              onClick={() => void renewTeamInvite(team.fp, item)}
            >
              {t("srv.newLink")}
            </button>
          ),
        ];
    }
  };
  return (
    <section className="grid gap-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className={H2}>{t("srv.setup")}</h2>
        <span className="text-xs text-s-muted">{t("srv.setupCount", { done, open: items.length - done })}</span>
      </div>
      <div className={CARD}>
        {items.map(item => {
          const [title, sub, action] = line(item);
          return (
            <div
              key={item.kind === "invite" ? item.id : item.kind}
              className="flex min-w-0 items-start gap-2.5 border-t border-s-border px-3.5 py-2.5 first:border-t-0"
            >
              <Icon
                name={item.done ? "check" : "alert"}
                className={`glyph mt-px size-4 flex-none stroke-2 ${item.done ? "text-s-ok" : "text-s-warn"}`}
              />
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="text-xs font-medium text-s-fg">{title}</span>
                {sub ? <span className="text-xs text-s-muted">{sub}</span> : null}
              </span>
              {action}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** A member's Overview: their workspaces here with Sync here…, New workspace…, their account, who can read, and what
 *  is for the organisation admins. */
function MemberOverview({ team }: { team: TeamServer }) {
  const { t } = useT();
  const me = useSettingsStore(s => s.team.me[team.fp]);
  const busy = useSettingsStore(s => !!s.shared.busy[`team:${team.fp}`]);
  const name = orgDisplayName(team);
  const roleKey = (role: string) =>
    role === "admin" ? "set.sharedAdmin" : role === "reader" ? "set.sharedReader" : "set.sharedMember";
  return (
    <div className="grid min-w-0 grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <div className="grid min-w-0 gap-5">
        <section className="grid gap-2.5">
          <h2 className={H2}>{t("srv.yourWorkspaces")}</h2>
          <div className={CARD}>
            {(me?.workspaces ?? []).map(w => (
              <div
                key={w.id}
                className="flex min-w-0 items-center gap-2.5 border-t border-s-border px-3.5 py-2.5 first:border-t-0"
              >
                <button
                  className="min-w-0 flex-1 truncate text-left text-xs text-s-fg hover:underline"
                  onClick={() => openOrgWorkspace(w.id)}
                >
                  {w.name}
                </button>
                <span className={PILL}>{t(roleKey(w.role))}</span>
                {w.here ? (
                  <StatusLine level="ok">{t("srv.synced")}</StatusLine>
                ) : (
                  <button
                    className={buttonClass()}
                    disabled={busy}
                    onClick={() => void syncTeamWorkspace(team.fp, w.id)}
                  >
                    {t("set.teamSyncHere")}
                  </button>
                )}
              </div>
            ))}
            <div className="flex min-w-0 items-center gap-2.5 border-t border-s-border px-3.5 py-2.5 first:border-t-0">
              <span className="flex-1 text-xs text-s-muted">{t("srv.anyoneMakes")}</span>
              <button
                className={buttonClass()}
                onClick={() => {
                  pickOrgTab("workspaces");
                  openForm("new", `team:${team.fp}`);
                }}
              >
                {t("set.teamNew")}
              </button>
            </div>
          </div>
        </section>
        <section className="grid gap-2.5">
          <h2 className={H2}>{t("srv.you")}</h2>
          <div className={CARD}>
            <div className={ROW}>
              <span className={KEY}>{t("srv.account")}</span>
              <span className="truncate text-xs text-s-fg">{team.email}</span>
            </div>
            <div className={ROW}>
              <span className={KEY}>{t("srv.nextDevice")}</span>
              <span className="flex items-center justify-between gap-2">
                <span className="text-xs text-s-muted">{t("srv.nextDeviceHelp")}</span>
                <CopyButton label={t("srv.copySignInLink")} get={() => teamLink(team.fp)} />
              </span>
            </div>
          </div>
        </section>
      </div>
      <div className="grid min-w-0 gap-5">
        <section className="grid gap-2.5">
          <h2 className={H2}>{name}</h2>
          <div className={CARD}>
            <div className={ROW}>
              <span className={KEY}>{t("srv.status")}</span>
              <ServerStatus team={team} />
            </div>
            <div className={ROW}>
              <span className={KEY}>{t("srv.whoCanRead")}</span>
              <span className="text-xs text-s-fg">{t("srv.whoCanReadOrg", { host: team.host })}</span>
            </div>
          </div>
        </section>
        <p className="flex items-start gap-2 text-xs text-s-muted">
          <Icon name="lock" className="glyph mt-px size-3.5 flex-none stroke-2" />
          {t("srv.memberNote")}
        </p>
        <OrgSignOut team={team} />
      </div>
    </div>
  );
}
