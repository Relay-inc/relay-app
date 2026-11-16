import { Fragment, useState } from "react";
import type { Machine, SharedInfo, SharedRole, SharedVault } from "../../../domain/settings/types";
import { agoParts } from "../../../domain/settings/machines";
import { orgDisplayName, teamOf } from "../../../domain/settings/servers";
import { useSettingsStore } from "../../../application/settings/store";
import { filesOn } from "../../../domain/settings/types";
import {
  closeInvite,
  createSharedVault,
  editForm,
  hideRecovery,
  openWorkspace,
  inviteToShared,
  joinSharedVault,
  leaveShared,
  trustMember,
  openForm,
  pickSharedFolder,
  removeMember,
  addToList,
  setMemberAdmin,
  setSharedDocs,
  settleShared,
  showRecovery,
  withdrawInvite,
} from "../../../application/settings/shared-vaults";
import { inviteTeam, setTeamMember } from "../../../application/settings/teams";
import { relativeFormat, sentAt } from "../../../shared/format";
import { Icon } from "../../components/Icon";
import { useT } from "../../hooks/useT";
import {
  BUTTON_GLYPH,
  buttonClass,
  ERROR_MESSAGE,
  FIELD,
  HINT_IN_ROW,
  PILL,
  ROW_DETAILS,
  SELECT,
  STATUS_TEXT,
  TILE,
} from "./blocks";
import { Field } from "./Field";
import { Footer } from "./Footer";
import { CommandBlock } from "./MachineSetup";
import { PathField } from "./PathField";
import { Section } from "./Section";
import { Segmented } from "./Segmented";
import { SettingsFold } from "./SettingsFold";
import { StatusLine } from "./StatusLine";
import { TrustBadge } from "./TrustBadge";
import { Switch } from "./Switch";

const EDGE = "border-t border-s-border px-3.5 py-3 first:border-t-0";
const ROW = `grid min-w-0 grid-cols-1 gap-2.5 ${EDGE}`;
const LABEL = "text-xs font-medium text-s-fg";

const roleKey = (role: string) =>
  role === "admin" ? "set.sharedAdmin" : role === "reader" ? "set.sharedReader" : "set.sharedMember";

/** This Mac on Organisations and servers: the personal workspaces on a server that is not one of this Mac's machines
 *  (joined with a link), a row each that opens its page, then Join a workspace with a link… or its form. */
export function SharedVaults({ vaults }: { vaults: SharedVault[] }) {
  const { t } = useT();
  return (
    <Section title={t("set.sharedTitle")} desc={t("set.sharedHelp")} list>
      {vaults.map(vault => (
        <SharedRow key={vault.id} vault={vault} />
      ))}
      <SharedForm machine="" />
    </Section>
  );
}

/** A machine's page on Organisations and servers: the workspaces it keeps, a row each that opens its page, and New workspace on
 *  this machine… or its form. Not on a server this Mac only keeps as a vault's admin: it may not make vaults there, so
 *  without workspaces there is nothing to show. */
export function MachineVaults({ machine, vaults = [] }: { machine: Machine; vaults?: SharedVault[] }) {
  const { t } = useT();
  if (machine.auto && !vaults.length) return null;
  return (
    <Section title={t("mc.workspaces", { name: machine.name })} list>
      {vaults.map(vault => (
        <SharedRow key={vault.id} vault={vault} />
      ))}
      {machine.auto ? null : <SharedForm machine={machine.id} />}
    </Section>
  );
}

/** The pills of a team workspace: the server reads along, and without history. */
function TeamPills({ vault }: { vault: SharedVault }) {
  const { t } = useT();
  const teams = useSettingsStore(s => s.settings.teams);
  if (!vault.team) return null;
  return (
    <>
      <span title={t("set.teamReadsAlongTip")}>
        <TrustBadge kind="org" name={orgDisplayName(teamOf(teams, vault))} />
      </span>
      {vault.nohistory ? (
        <span className={PILL} title={t("set.sharedNoHistoryTip")}>
          {t("set.sharedNoHistoryLabel")}
        </span>
      ) : null}
    </>
  );
}

/** A workspace in a list: its name, server and this Mac's role in it, opening its page. */
function SharedRow({ vault }: { vault: SharedVault }) {
  const { t } = useT();
  const info = useSettingsStore(s => s.shared.info[vault.id]);
  return (
    <SettingsFold
      id={vault.id}
      nav
      icon={<Icon name="folderLinked" className={TILE} />}
      name={vault.name}
      status={
        <span className={STATUS_TEXT}>
          <span className="font-mono">{vault.host}</span>
          <span className={PILL}>{t(roleKey(info?.vault.role ?? vault.role))}</span>
          <TeamPills vault={vault} />
        </span>
      }
      onToggle={() => openWorkspace(vault.id)}
    />
  );
}

/** A workspace's page on Organisations and servers: its folder (and for a personal one its recovery key), Members with
 *  their invites, Documents, Sync (the last round and what waits for a choice) and Leave. */
export function WorkspacePage({ vault }: { vault: SharedVault }) {
  const { t, tn, locale } = useT();
  const status = useSettingsStore(s => s.shared.status[vault.id]);
  const files = useSettingsStore(s => filesOn(s.settings));
  const info = useSettingsStore(s => s.shared.info[vault.id]);
  const recovery = useSettingsStore(s => s.shared.keys[vault.id]);
  const message = useSettingsStore(s => s.shared.messages[vault.id]);
  const busy = useSettingsStore(s => !!s.shared.busy[vault.id]);
  const [leaving, setLeaving] = useState(false);
  const mine: SharedRole = info?.vault.role ?? vault.role;
  const ago = status ? agoParts(status.at) : null;
  // making the notes documents: a personal workspace's admin turns it on (every member sees which), a team one has it
  const docs = !vault.team && !!status && files && (status.admin || !!status.docs);
  return (
    <>
      <header className="grid gap-3">
        <button className={`${buttonClass("ghost")} -ml-2 justify-self-start`} onClick={() => openWorkspace("")}>
          <Icon name="left" className={BUTTON_GLYPH} />
          {t("set.tab.workspaces")}
        </button>
        <div className={ROW_DETAILS}>
          <h1 className="text-base font-semibold text-s-fg">{vault.name}</h1>
          <span className={PILL}>{t(roleKey(mine))}</span>
          <TeamPills vault={vault} />
          <span className="font-mono text-xs text-s-muted">{vault.host}</span>
        </div>
        {message ? <span className={message.ok ? HINT_IN_ROW : ERROR_MESSAGE}>{message.text}</span> : null}
      </header>

      <Section title={t("set.sharedFolder")}>
        <div className="flex min-w-0 items-center gap-2">
          <code className="min-w-0 flex-1 truncate font-mono text-xs text-s-fg" title={vault.folder}>
            {vault.folder}
          </code>
          {/* a team workspace's key is the server's: there is nothing to recover from here */}
          {recovery || vault.team ? null : (
            <button className={buttonClass("ghost")} disabled={busy} onClick={() => showRecovery(vault.id)}>
              {t("set.sharedShowRecovery")}
            </button>
          )}
        </div>
        {recovery ? (
          <div className="grid gap-1.5">
            <span className={LABEL}>{t("set.sharedRecovery")}</span>
            <CommandBlock hint={t("set.sharedRecoveryHelp")} command={recovery} wrap />
            <div>
              <button className={`${buttonClass("ghost")} -ml-3`} onClick={() => hideRecovery(vault.id)}>
                {t("set.sharedDone")}
              </button>
            </div>
          </div>
        ) : null}
      </Section>

      {vault.team ? <TeamMembers vault={vault} info={info} /> : <Members vault={vault} info={info} />}

      {/* a team workspace's history is set when it is made, for good */}
      {vault.team ? (
        <Section title={t(vault.nohistory ? "srv.historyOff" : "srv.historyOn")}>
          <span className="text-xs text-s-muted">
            {t(vault.nohistory ? "srv.historyOffHelp" : "srv.historyOnHelp")}
          </span>
        </Section>
      ) : null}

      {docs && status ? (
        <Section title={t("set.sharedDocs")}>
          <div className="flex items-start gap-3">
            <span className="flex-1 text-xs text-s-muted">{t("set.sharedDocsHelp")}</span>
            {status.admin ? (
              <Switch id={`docs-${vault.id}`} on={!!status.docs} onToggle={on => setSharedDocs(vault.id, on)} />
            ) : (
              <span className={PILL}>{t("set.sharedDocsOn")}</span>
            )}
          </div>
        </Section>
      ) : null}

      <Section title={t("set.wsSync")}>
        {status ? (
          <div className="grid gap-1">
            <span className="text-xs text-s-muted">
              {ago
                ? t("set.sharedLast", { when: relativeFormat(locale, { numeric: "auto" }).format(ago.value, ago.unit) })
                : t("set.sharedNever")}
              {" · "}
              {t("set.sharedCounts", { sent: status.pushed, received: status.pulled })}
            </span>
            {status.errors.map((error, index) => (
              <StatusLine key={index} level="warn">
                {error}
              </StatusLine>
            ))}
            {status.bad ? <StatusLine level="warn">{tn("set.sharedBad", status.bad)}</StatusLine> : null}
            {/* a reader's rounds only pull: what changed in the folder here stays here, said once */}
            {status.unsent ? <StatusLine level="warn">{tn("set.sharedUnsent", status.unsent)}</StatusLine> : null}
            {status.conflicts.length ? (
              <div className="grid gap-0.5">
                <span className="text-xs text-s-muted">{tn("set.sharedConflicts", status.conflicts.length)}</span>
                {status.conflicts.map(path => (
                  <span key={path} className="truncate font-mono text-xs text-s-fg" title={path}>
                    {path}
                  </span>
                ))}
              </div>
            ) : null}
            {status.names?.length ? (
              <div className="grid gap-0.5">
                <StatusLine level="warn">{tn("set.sharedNames", status.names.length)}</StatusLine>
                <div className="grid max-h-40 gap-0.5 overflow-y-auto">
                  {status.names.map(path => (
                    <span key={path} className="truncate font-mono text-xs text-s-fg" title={path}>
                      {path}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            {/* more deletes at once than a round lets through on its own: nothing goes until a choice */}
            {status.held.length ? (
              <div className="grid gap-1">
                <StatusLine level="warn">{tn("set.sharedHeld", status.held.length)}</StatusLine>
                {/* every path, not the first few: Delete lets through exactly the list on screen */}
                <div className="grid max-h-40 gap-1 overflow-y-auto">
                  {status.held.map(path => (
                    <span key={path} className="truncate font-mono text-xs text-s-fg" title={path}>
                      {path}
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    className={buttonClass()}
                    disabled={busy}
                    onClick={() => settleShared(vault.id, false, status.held)}
                  >
                    {t("set.sharedHeldRestore")}
                  </button>
                  <button
                    className={buttonClass("danger")}
                    disabled={busy}
                    onClick={() => settleShared(vault.id, true, status.held)}
                  >
                    {t("set.sharedHeldDelete")}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <span className="text-xs text-s-muted">{t("set.sharedNever")}</span>
        )}
      </Section>

      <Section
        title={t("set.wsLeaveTitle", { name: vault.name })}
        desc={t("set.sharedLeaveHelp")}
        action={
          leaving ? (
            <>
              <span className="text-xs text-s-muted">{t("set.sharedLeaveSure")}</span>
              <button
                className={buttonClass("dangerSolid")}
                disabled={busy}
                onClick={async () => {
                  await leaveShared(vault.id);
                  setLeaving(false);
                }}
              >
                {t("set.sharedLeave")}
              </button>
              <button className={buttonClass("ghost")} onClick={() => setLeaving(false)}>
                {t("mc.cancel")}
              </button>
            </>
          ) : (
            <button className={buttonClass("danger")} disabled={busy} onClick={() => setLeaving(true)}>
              {t("set.sharedLeave")}
            </button>
          )
        }
      />
    </>
  );
}

/** A personal workspace's members (as on main): its devices with their role, the member list's warnings and changed
 *  keys, and an admin's invite links. */
function Members({ vault, info }: { vault: SharedVault; info: SharedInfo | null | undefined }) {
  const { t, locale } = useT();
  const status = useSettingsStore(s => s.shared.status[vault.id]);
  const link = useSettingsStore(s => s.shared.links[vault.id]);
  const busy = useSettingsStore(s => !!s.shared.busy[vault.id]);
  const [inviting, setInviting] = useState(false);
  const [role, setRole] = useState<SharedRole>("member");
  const [trusting, setTrusting] = useState<string | null>(null);
  const [removing, setRemoving] = useState(""); // the member whose Remove asks first, by fingerprint
  // the member list decides once there is one; before it, the server's word once read (the settings can be older)
  const admins = status?.admins;
  const roleOf = (fp: string, server: SharedRole): SharedRole =>
    admins ? (admins.includes(fp) ? "admin" : "member") : server;
  // on the server but not on the member list (its Relay published keys after the list was made): no role, no remove
  const unlisted = (fp: string) => !!status?.listed && !status.listed.includes(fp);
  const admin = (info?.vault.role ?? vault.role) === "admin";
  const until = (expires: number) => sentAt(expires * 1000, locale);
  const invites = info?.vault.invites ?? [];
  return (
    <>
      <Section title={t("set.sharedMembers")}>
        {status?.rekeying ? <StatusLine level="warn">{t("set.sharedRekeying")}</StatusLine> : null}
        {/* the member list: held back, forked, or a removal still waiting for its key change */}
        {status?.warnings?.map(w => (
          <StatusLine key={w} level="warn">
            {w}
          </StatusLine>
        ))}
        {/* a member's Relay publishes other keys than the member list has: they set it up again, or someone is in between */}
        {status?.changed?.map(c => (
          <div key={c.fp} className="grid gap-1">
            <StatusLine level="warn">{t("set.sharedKeyChanged", { name: c.name })}</StatusLine>
            {admin ? (
              trusting === c.fp ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-s-muted">{t("set.sharedTrustSure", { name: c.name })}</span>
                  <button
                    className={buttonClass("dangerSolid")}
                    disabled={busy}
                    onClick={async () => {
                      await trustMember(vault.id, c.fp);
                      setTrusting(null);
                    }}
                  >
                    {t("set.sharedTrust")}
                  </button>
                  <button className={buttonClass("ghost")} onClick={() => setTrusting(null)}>
                    {t("mc.cancel")}
                  </button>
                </div>
              ) : (
                <div>
                  <button className={buttonClass("ghost")} disabled={busy} onClick={() => setTrusting(c.fp)}>
                    {t("set.sharedTrustAsk", { name: c.name })}
                  </button>
                </div>
              )
            ) : null}
          </div>
        ))}
        {info ? (
          <div className="grid min-w-0 gap-1.5">
            {info.vault.members.map(member => (
              <Fragment key={member.fp}>
                <div className="flex min-h-7 items-center gap-2">
                  <span className="min-w-0 truncate text-xs text-s-fg">
                    {member.name}
                    {member.fp === info.me ? <span className="text-s-muted"> · {t("set.sharedThisMac")}</span> : null}
                  </span>
                  <span className={PILL}>
                    {unlisted(member.fp) ? t("set.sharedNotListed") : t(roleKey(roleOf(member.fp, member.role)))}
                  </span>
                  <span className="flex-1"></span>
                  {status?.admin && unlisted(member.fp) ? (
                    <button
                      className={buttonClass("ghost")}
                      disabled={busy}
                      onClick={() => addToList(vault.id, member.fp)}
                    >
                      {t("set.sharedAddToList")}
                    </button>
                  ) : null}
                  {status?.admin &&
                  admins &&
                  !unlisted(member.fp) &&
                  member.fp !== info.me &&
                  removing !== member.fp ? (
                    <button
                      className={buttonClass("ghost")}
                      disabled={busy}
                      onClick={() => setMemberAdmin(vault.id, member.fp, !admins.includes(member.fp))}
                    >
                      {t(admins.includes(member.fp) ? "set.sharedMakeMember" : "set.sharedMakeAdmin")}
                    </button>
                  ) : null}
                  {!admin || member.fp === info.me || unlisted(member.fp) ? null : removing === member.fp ? (
                    <>
                      <span className="text-xs text-s-muted">{t("set.sharedRemoveSure")}</span>
                      <button
                        className={buttonClass("dangerSolid")}
                        disabled={busy}
                        aria-label={t("set.extraVaultRemove", { name: member.name })}
                        onClick={async () => {
                          await removeMember(vault.id, member.fp);
                          setRemoving("");
                        }}
                      >
                        {t("ag.remove")}
                      </button>
                      <button className={buttonClass("ghost")} onClick={() => setRemoving("")}>
                        {t("mc.cancel")}
                      </button>
                    </>
                  ) : (
                    <button
                      className={buttonClass("ghost")}
                      aria-label={t("set.extraVaultRemove", { name: member.name })}
                      onClick={() => setRemoving(member.fp)}
                    >
                      {t("ag.remove")}
                    </button>
                  )}
                </div>
                {status?.admin && unlisted(member.fp) ? (
                  <span className="text-xs text-s-muted">{t("set.sharedNotListedHint")}</span>
                ) : null}
              </Fragment>
            ))}
          </div>
        ) : (
          <span className="text-xs text-s-muted">{t("set.sharedAsking")}</span>
        )}
      </Section>

      <Section
        title={t("set.wsInvites")}
        action={
          admin && !inviting && !link ? (
            <button className={buttonClass()} onClick={() => setInviting(true)}>
              {t("set.sharedInvite")}
            </button>
          ) : null
        }
      >
        {link ? (
          <div className="grid gap-1.5">
            <span className={LABEL}>{t("set.sharedLink", { role: t(roleKey(link.invite.role)) })}</span>
            <CommandBlock
              hint={t("set.sharedLinkHelp", { time: until(link.invite.expires) })}
              command={link.link}
              wrap
            />
            <div>
              <button className={`${buttonClass("ghost")} -ml-3`} onClick={() => closeInvite(vault.id)}>
                {t("set.sharedDone")}
              </button>
            </div>
          </div>
        ) : inviting ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className={LABEL}>{t("set.sharedInviteAs")}</span>
            <Segmented
              label={t("set.sharedInviteAs")}
              options={[
                ["member", t("set.sharedMember")],
                ["admin", t("set.sharedAdmin")],
              ]}
              value={role}
              onPick={setRole}
            />
            <span className="flex-1"></span>
            <button className={buttonClass("ghost")} onClick={() => setInviting(false)}>
              {t("mc.cancel")}
            </button>
            <button
              className={buttonClass("primary")}
              disabled={busy}
              onClick={async () => {
                await inviteToShared(vault.id, role);
                setInviting(false);
              }}
            >
              {t("set.sharedMakeLink")}
            </button>
          </div>
        ) : null}
        {admin && invites.length ? (
          <div className="grid min-w-0 gap-1.5">
            <span className={LABEL}>{t("set.sharedInvites")}</span>
            {invites.map(invite => (
              <div key={invite.id} className="flex min-h-7 items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-xs text-s-muted">
                  {t("set.sharedInviteOpen", { role: t(roleKey(invite.role)), time: until(invite.expires) })}
                </span>
                <button
                  className={buttonClass("ghost")}
                  disabled={busy}
                  onClick={() => withdrawInvite(vault.id, invite.id)}
                >
                  {t("set.sharedWithdraw")}
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </Section>
    </>
  );
}

/** A team workspace's members by email with their role. Its admin (or an organisation admin) changes a role, takes
 *  someone out, and invites an address with a role: a new account gets a link for one of its devices. */
function TeamMembers({ vault, info }: { vault: SharedVault; info: SharedInfo | null | undefined }) {
  const { t } = useT();
  const team = useSettingsStore(s => s.settings.teams?.find(x => x.fp === vault.fp));
  const overview = useSettingsStore(s => s.team.overview[vault.fp]);
  const busy = useSettingsStore(s => !!s.shared.busy[vault.id]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<SharedRole>("member");
  const [link, setLink] = useState({ email: "", link: "" });
  const [removing, setRemoving] = useState("");
  const manages = (info?.vault.role ?? vault.role) === "admin" || !!team?.admin;
  const roles: [SharedRole, string][] = [
    ["member", t("set.sharedMember")],
    ["reader", t("set.sharedReader")],
    ["admin", t("set.sharedAdmin")],
  ];
  const reread = () => openWorkspace(vault.id, true);
  return (
    <Section title={t("set.sharedMembers")}>
      {info ? (
        <div className="grid min-w-0 gap-1.5">
          {(info.vault.accounts ?? []).map(a => (
            <div key={a.email} className="flex min-h-7 items-center gap-2">
              <span className="min-w-0 truncate text-xs text-s-fg">
                {a.email}
                {a.email === team?.email ? <span className="text-s-muted"> · {t("set.teamYou")}</span> : null}
              </span>
              <span className="flex-1"></span>
              {manages && removing !== a.email ? (
                <select
                  className={SELECT}
                  aria-label={t("set.sharedRoleOf", { name: a.email })}
                  disabled={busy}
                  value={a.role}
                  onChange={async e => {
                    await setTeamMember(vault.fp, vault.id, a.email, e.target.value as SharedRole);
                    reread();
                  }}
                >
                  {roles.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              ) : (
                <span className={PILL}>{t(roleKey(a.role))}</span>
              )}
              {!manages || a.email === team?.email ? null : removing === a.email ? (
                <>
                  <span className="text-xs text-s-muted">{t("set.sharedRemoveSure")}</span>
                  <button
                    className={buttonClass("dangerSolid")}
                    disabled={busy}
                    onClick={async () => {
                      await setTeamMember(vault.fp, vault.id, a.email, "");
                      setRemoving("");
                      reread();
                    }}
                  >
                    {t("ag.remove")}
                  </button>
                  <button className={buttonClass("ghost")} onClick={() => setRemoving("")}>
                    {t("mc.cancel")}
                  </button>
                </>
              ) : (
                <button
                  className={buttonClass("ghost")}
                  aria-label={t("set.extraVaultRemove", { name: a.email })}
                  onClick={() => setRemoving(a.email)}
                >
                  {t("ag.remove")}
                </button>
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
      ) : manages ? (
        // a row, not a form: the role's buttons would submit it
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <input
            className={`${FIELD} min-w-0 flex-1 basis-48`}
            type="email"
            aria-label={t("set.teamInviteEmail")}
            placeholder={t("set.teamInviteEmail")}
            value={email}
            onChange={e => setEmail(e.target.value)}
          />
          <Segmented label={t("set.sharedInviteAs")} options={roles} value={role} onPick={setRole} />
          <button
            className={buttonClass("primary")}
            disabled={busy || !email.includes("@")}
            onClick={async () => {
              const who = email.trim().toLowerCase();
              // an account the organisation has is only added: an organisation admin's invite would make it a link
              // that logs in as that person
              if (overview?.accounts.some(a => a.email === who)) {
                if (await setTeamMember(vault.fp, vault.id, who, role)) setEmail("");
                reread();
                return;
              }
              const made = await inviteTeam(vault.fp, who, vault.id, role);
              if (made !== null) {
                setEmail("");
                if (made) setLink({ email: who, link: made });
                reread();
              }
            }}
          >
            {t("set.sharedInvite")}
          </button>
        </div>
      ) : null}
      {manages && !link.link ? <span className="text-xs text-s-muted">{t("set.teamInviteHelp")}</span> : null}
    </Section>
  );
}

/** Under a machine (`machine` its id, a team server's `team:<fp>`) New workspace…, in Workspaces ("") Join a workspace
 *  with a link…, or the form it opened. The one form and its message show where `form.machine` says. */
function SharedForm({ machine }: { machine: string }) {
  const { t } = useT();
  const form = useSettingsStore(s => (s.shared.form.machine === machine ? s.shared.form : null));
  const message = useSettingsStore(s => (s.shared.form.machine === machine ? s.shared.messages.form : null));
  const busy = useSettingsStore(s => !!s.shared.busy.form);
  const team = machine.startsWith("team:");
  const folder = (
    <Field label={t("set.sharedFolder")} hint={machine ? t("set.sharedNewFolderHelp") : t("set.sharedJoinFolderHelp")}>
      <PathField
        value={form?.folder ?? ""}
        tip={form?.folder ?? ""}
        readOnly
        placeholder={t("vault.none")}
        pickTip={t("vault.pickPath")}
        onPick={pickSharedFolder}
      />
    </Field>
  );
  const footer = (action: string, disabled: boolean, onClick: () => void) => (
    <div className="flex flex-wrap items-center gap-2">
      <Footer message={message}>
        <button className={buttonClass("ghost")} onClick={() => openForm("")}>
          {t("mc.cancel")}
        </button>
        <button className={buttonClass("primary")} disabled={disabled} onClick={onClick}>
          {action}
        </button>
      </Footer>
    </div>
  );

  if (form?.mode === "new")
    return (
      <div className={ROW}>
        <span className={LABEL}>{t("set.sharedNewTitle")}</span>
        <Field label={t("set.sharedName")} id="shared-name">
          <input
            id="shared-name"
            className={FIELD}
            placeholder={t("set.sharedNamePlaceholder")}
            value={form.name}
            onChange={e => editForm({ name: e.target.value })}
          />
        </Field>
        {folder}
        {team ? (
          <Field label={t("set.sharedNoHistory")} hint={t("set.sharedNoHistoryHelp")} id="shared-nohistory">
            <input
              id="shared-nohistory"
              type="checkbox"
              checked={form.noHistory}
              onChange={e => editForm({ noHistory: e.target.checked })}
            />
          </Field>
        ) : null}
        {footer(t("set.sharedCreate"), busy || !form.name.trim() || !form.folder, createSharedVault)}
      </div>
    );
  if (form?.mode === "join")
    return (
      <div className={ROW}>
        <span className={LABEL}>{t("set.sharedJoinTitle")}</span>
        <Field label={t("set.sharedLinkLabel")} id="shared-link" hint={t("set.sharedLinkLabelHelp")}>
          <input
            id="shared-link"
            className={`${FIELD} font-mono`}
            placeholder="relay://…"
            spellCheck={false}
            value={form.link}
            onChange={e => editForm({ link: e.target.value })}
          />
        </Field>
        {folder}
        {footer(t("set.sharedJoinButton"), busy || !form.link.trim() || !form.folder, joinSharedVault)}
      </div>
    );
  // a create or join that ends closes the form: what its reload said shows here
  return (
    <div className={`flex flex-wrap items-center gap-2 ${EDGE}`}>
      <button className={buttonClass()} disabled={busy} onClick={() => openForm(machine ? "new" : "join", machine)}>
        {t(team ? "set.teamNew" : machine ? "set.sharedNew" : "set.sharedJoin")}
      </button>
      {message ? <span className={message.ok ? HINT_IN_ROW : ERROR_MESSAGE}>{message.text}</span> : null}
    </div>
  );
}
