import { Fragment, useState } from "react";
import type { Machine, SharedInfo, SharedRole, SharedVault, Sso, SsoLogin } from "../../../domain/settings/types";
import { agoParts } from "../../../domain/settings/machines";
import { useSettingsStore } from "../../../application/settings/store";
import { filesOn, GOOGLE_ISSUER, POLICY_PROVIDERS } from "../../../domain/settings/types";
import {
  closeInvite,
  createSharedVault,
  editForm,
  hideRecovery,
  inviteToShared,
  joinSharedVault,
  leaveShared,
  trustMember,
  openForm,
  pickSharedFolder,
  removeMember,
  removePerson,
  setPerson,
  addToList,
  setMemberRole,
  setSharedDocs,
  setSharedPolicy,
  addOrgAdmins,
  settleShared,
  showRecovery,
  toggleMembers,
  withdrawInvite,
  ssoCancel,
  ssoSignIn,
} from "../../../application/settings/shared-vaults";
import { relativeFormat, sentAt } from "../../../shared/format";
import { useT } from "../../hooks/useT";
import {
  buttonClass,
  ERROR_MESSAGE,
  FIELD,
  HINT_IN_ROW,
  PILL,
  ROW_ACTIONS,
  ROW_DETAILS,
  ROW_HEAD,
  SELECT,
} from "./blocks";
import { Field } from "./Field";
import { Footer } from "./Footer";
import { CommandBlock } from "./MachineSetup";
import { PathField } from "./PathField";
import { Section } from "./Section";
import { Segmented } from "./Segmented";
import { StatusLine } from "./StatusLine";
import { Switch } from "./Switch";

const EDGE = "border-b border-s-border px-3.5 py-3 last:border-b-0";
const ROW = `grid min-w-0 grid-cols-1 gap-2.5 ${EDGE}`;
const LABEL = "text-xs font-medium text-s-fg";

/** Settings › Machines › Workspaces: the workspaces on a server that is not one of this Mac's machines (joined with a
 *  link), each with its last round, invites, members and Leave, then Join a workspace with a link… or its form. */
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

/** In a machine's row on Settings › Machines, like its repos: a title, then a card with the workspaces it keeps and
 *  New workspace on this machine… or its form. Not on a server this Mac only keeps as a vault's admin: it may not make
 *  vaults there, so without workspaces there is nothing to show. */
export function MachineVaults({ machine, vaults = [] }: { machine: Machine; vaults?: SharedVault[] }) {
  const { t } = useT();
  if (machine.auto && !vaults.length) return null;
  return (
    <div className="grid gap-1.5">
      <span className={LABEL}>{t("mc.workspaces", { name: machine.name })}</span>
      <div className="grid min-w-0 grid-cols-1 rounded-lg border border-s-border">
        {vaults.map(vault => (
          <SharedRow key={vault.id} vault={vault} />
        ))}
        {machine.auto ? null : <SharedForm machine={machine.id} />}
      </div>
    </div>
  );
}

/** The agents a workspace policy names, as Relay calls them. */
const PROVIDER_NAMES: Record<string, string> = { claude: "Claude Code", codex: "Codex" };

function SharedRow({ vault }: { vault: SharedVault }) {
  const { t, tn, locale } = useT();
  const status = useSettingsStore(s => s.shared.status[vault.id]);
  const files = useSettingsStore(s => filesOn(s.settings));
  const info = useSettingsStore(s => s.shared.info[vault.id]);
  const membersOpen = useSettingsStore(s => vault.id in s.shared.info);
  const link = useSettingsStore(s => s.shared.links[vault.id]);
  const recovery = useSettingsStore(s => s.shared.keys[vault.id]);
  const message = useSettingsStore(s => s.shared.messages[vault.id]);
  const busy = useSettingsStore(s => !!s.shared.busy[vault.id]);
  const [inviting, setInviting] = useState(false);
  const [role, setRole] = useState<SharedRole>("member");
  const [leaving, setLeaving] = useState(false);
  const [trusting, setTrusting] = useState<string | null>(null);
  const [removing, setRemoving] = useState(""); // the member whose Remove asks first, by fingerprint
  const [removingPerson, setRemovingPerson] = useState(""); // the person whose Remove asks first, by id
  const [naming, setNaming] = useState<{ who: string; fp: string } | null>(null); // the person form open: who, device
  const [personForm, setPersonForm] = useState({ pick: "", name: "", email: "" });
  // the member list decides once there is one; before it, the server's word once read (the settings can be older)
  const admins = status?.admins;
  const roleOf = (fp: string, server: SharedRole): SharedRole =>
    admins ? (admins.includes(fp) ? "admin" : status?.readers?.includes(fp) ? "reader" : "member") : server;
  // on the server but not on the member list (its Relay published keys after the list was made): no role, no remove
  const unlisted = (fp: string) => !!status?.listed && !status.listed.includes(fp);
  const mine: SharedRole = admins
    ? status?.admin
      ? "admin"
      : status?.reader
        ? "reader"
        : "member"
    : (info?.vault.role ?? vault.role);
  const admin = mine === "admin";
  // a reader signs nothing on the member list but its leave: no naming, adding or removing of its own person
  const own = mine !== "reader";
  const ago = status ? agoParts(status.at) : null;
  const roleName = (role: string) =>
    t(role === "admin" ? "set.sharedAdmin" : role === "reader" ? "set.sharedReader" : "set.sharedMember");
  const roles: [SharedRole, string][] = [
    ["member", t("set.sharedMember")],
    ["reader", t("set.sharedReader")],
    ["admin", t("set.sharedAdmin")],
  ];
  const until = (expires: number) => sentAt(expires * 1000, locale);
  // people (docs/workspaces.md, People): the member list as this Mac checked it, before its first round the server's
  const people = status?.people ?? info?.vault.people ?? [];
  const myself = info ? people.find(p => p.devices.includes(info.me)) : undefined;
  const loose = info ? info.vault.members.filter(m => !people.some(p => p.devices.includes(m.fp))) : [];
  const startNaming = (who: string, fp: string, name = "", email = "") => {
    setNaming({ who, fp });
    setPersonForm({ pick: "", name, email });
  };
  // a person named or renamed, or a device put under one: new (`pick` "") with the name typed, or one there is
  const nameForm = naming ? (
    <form
      className="flex min-w-0 flex-wrap items-center gap-2 ps-4"
      onSubmit={async e => {
        e.preventDefault();
        const picked = people.find(p => p.who === personForm.pick);
        const done = picked
          ? await setPerson(vault.id, picked.who, picked.name, picked.email, naming.fp)
          : await setPerson(vault.id, naming.who, personForm.name, personForm.email, naming.fp);
        if (done) setNaming(null);
      }}
    >
      {naming.fp && status?.admin && people.length ? (
        <select
          className={SELECT}
          aria-label={t("set.sharedPerson")}
          value={personForm.pick}
          onChange={e => setPersonForm({ ...personForm, pick: e.target.value })}
        >
          <option value="">{t("set.sharedPersonNew")}</option>
          {people.map(p => (
            <option key={p.who} value={p.who}>
              {p.name}
            </option>
          ))}
        </select>
      ) : null}
      {personForm.pick ? null : (
        <>
          <input
            className={`${FIELD} min-w-0 flex-1 basis-40`}
            aria-label={t("set.sharedPersonName")}
            placeholder={t("set.sharedPersonName")}
            maxLength={100}
            autoFocus
            value={personForm.name}
            onChange={e => setPersonForm({ ...personForm, name: e.target.value })}
          />
          <input
            className={`${FIELD} min-w-0 flex-1 basis-40`}
            type="email"
            aria-label={t("set.sharedPersonEmail")}
            placeholder={t("set.sharedPersonEmail")}
            value={personForm.email}
            onChange={e => setPersonForm({ ...personForm, email: e.target.value })}
          />
        </>
      )}
      <span className="flex-1"></span>
      <button type="button" className={buttonClass("ghost")} onClick={() => setNaming(null)}>
        {t("mc.cancel")}
      </button>
      <button
        type="submit"
        className={buttonClass("primary")}
        disabled={busy || (!personForm.pick && !personForm.name.trim())}
      >
        {t("set.save")}
      </button>
    </form>
  ) : null;
  // one device: its name, role and the admin's buttons; `nested` under its person
  const device = (member: SharedInfo["vault"]["members"][number], nested: boolean) =>
    info ? (
      <Fragment key={member.fp}>
        <div className={`flex min-h-7 items-center gap-2 ${nested ? "ps-4" : ""}`}>
          <span className="min-w-0 truncate text-xs text-s-fg">
            {member.name}
            {member.fp === info.me ? <span className="text-s-muted"> · {t("set.sharedThisMac")}</span> : null}
          </span>
          {/* an admin picks another member's role here, everyone else sees it */}
          {status?.admin && admins && !unlisted(member.fp) && member.fp !== info.me && removing !== member.fp ? (
            <select
              className={SELECT}
              aria-label={t("set.sharedRoleOf", { name: member.name })}
              disabled={busy}
              value={roleOf(member.fp, member.role)}
              onChange={e => setMemberRole(vault.id, member.fp, e.target.value as SharedRole)}
            >
              {roles.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          ) : (
            <span className={PILL}>
              {unlisted(member.fp) ? t("set.sharedNotListed") : roleName(roleOf(member.fp, member.role))}
            </span>
          )}
          <span className="flex-1"></span>
          {status?.admin && unlisted(member.fp) ? (
            <button className={buttonClass("ghost")} disabled={busy} onClick={() => addToList(vault.id, member.fp)}>
              {t("set.sharedAddToList")}
            </button>
          ) : null}
          {status?.people && !nested && !unlisted(member.fp) && (status.admin || (own && member.fp === info.me)) ? (
            <button className={buttonClass("ghost")} disabled={busy} onClick={() => startNaming("", member.fp)}>
              {t("set.sharedNamePerson")}
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
        {naming?.fp === member.fp ? nameForm : null}
      </Fragment>
    ) : null;
  return (
    <div className={ROW}>
      <div className={ROW_HEAD}>
        <div className={ROW_DETAILS}>
          <span className="text-[13px] font-semibold text-s-fg">{vault.name}</span>
          <span className={PILL}>{roleName(mine)}</span>
          {status?.nohistory ? (
            <span className={PILL} title={t("set.sharedNoHistoryTip")}>
              {t("set.sharedNoHistoryLabel")}
            </span>
          ) : null}
          <span className="font-mono text-xs text-s-muted">{vault.host}</span>
        </div>
        <div className={ROW_ACTIONS}>
          {admin && !inviting && !link ? (
            <button className={buttonClass("ghost")} onClick={() => setInviting(true)}>
              {t("set.sharedInvite")}
            </button>
          ) : null}
          <button
            className={buttonClass("ghost")}
            aria-expanded={membersOpen}
            disabled={busy}
            onClick={() => toggleMembers(vault.id)}
          >
            {t("set.sharedMembers")}
          </button>
          {leaving ? (
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
          )}
        </div>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <code className="min-w-0 flex-1 truncate font-mono text-xs text-s-fg" title={vault.folder}>
          {vault.folder}
        </code>
        {recovery ? null : (
          <button className={buttonClass("ghost")} disabled={busy} onClick={() => showRecovery(vault.id)}>
            {t("set.sharedShowRecovery")}
          </button>
        )}
      </div>
      {leaving ? <p className={HINT_IN_ROW}>{t("set.sharedLeaveHelp")}</p> : null}

      <div className="grid gap-1">
        {status ? (
          <>
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
            {/* making the notes documents: off until an admin turns it on; every member sees which */}
            {files && (status.admin || status.docs) ? (
              <div className="flex items-start gap-3 py-1">
                <div className="grid flex-1 gap-0.5">
                  <label htmlFor={`docs-${vault.id}`} className="text-xs text-s-fg">
                    {t("set.sharedDocs")}
                  </label>
                  <span className="text-xs text-s-muted">{t("set.sharedDocsHelp")}</span>
                </div>
                {status.admin ? (
                  <Switch id={`docs-${vault.id}`} on={!!status.docs} onToggle={on => setSharedDocs(vault.id, on)} />
                ) : (
                  <span className={PILL}>{t("set.sharedDocsOn")}</span>
                )}
              </div>
            ) : null}
            {/* the signed policy (docs/workspaces.md, Policy): an admin picks the agents and capture, a member sees it */}
            {status.admin ? (
              <div className="grid gap-1.5 py-1">
                <span className="text-xs text-s-fg">{t("set.policyAgents")}</span>
                <span className="text-xs text-s-muted">{t("set.policyAgentsHelp")}</span>
                <div className="flex flex-wrap items-center gap-4">
                  {POLICY_PROVIDERS.map(p => {
                    const allowed = status.policy?.providers ?? POLICY_PROVIDERS;
                    const on = allowed.includes(p);
                    return (
                      <label key={p} className="flex items-center gap-1.5 text-xs text-s-fg">
                        <input
                          type="checkbox"
                          checked={on}
                          // at least one agent: an empty policy is refused by every member's Mac
                          disabled={busy || (on && allowed.length === 1)}
                          onChange={() =>
                            setSharedPolicy(
                              vault.id,
                              POLICY_PROVIDERS.filter(x => (x === p ? !on : allowed.includes(x))),
                              !!status.policy?.capture,
                            )
                          }
                        />
                        {PROVIDER_NAMES[p] ?? p}
                      </label>
                    );
                  })}
                </div>
                <div className="flex items-start gap-3">
                  <div className="grid flex-1 gap-0.5">
                    <label htmlFor={`capture-${vault.id}`} className="text-xs text-s-fg">
                      {t("set.policyCapture")}
                    </label>
                    <span className="text-xs text-s-muted">{t("set.policyCaptureHelp")}</span>
                  </div>
                  <Switch
                    id={`capture-${vault.id}`}
                    on={!!status.policy?.capture}
                    onToggle={on => setSharedPolicy(vault.id, status.policy?.providers ?? POLICY_PROVIDERS, on)}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="flex-1 text-xs text-s-muted">{t("set.orgAddToWorkspaceHelp")}</span>
                  <button className={buttonClass()} disabled={busy} onClick={() => addOrgAdmins(vault.id)}>
                    {t("set.orgAddToWorkspace")}
                  </button>
                </div>
              </div>
            ) : status.policy ? (
              <span className="text-xs text-s-muted">
                {t("set.policyIs", {
                  agents: status.policy.providers.map(p => PROVIDER_NAMES[p] ?? p).join(", "),
                  capture: t(status.policy.capture ? "set.policyCaptureOn" : "set.policyCaptureOff"),
                })}
              </span>
            ) : null}
            {status.rekeying ? <StatusLine level="warn">{t("set.sharedRekeying")}</StatusLine> : null}
            {/* the member list: held back, forked, or a removal still waiting for its key change */}
            {status.warnings?.map(w => (
              <StatusLine key={w} level="warn">
                {w}
              </StatusLine>
            ))}
            {/* a member's Relay publishes other keys than the member list has: they set it up again, or someone is in between */}
            {status.changed?.map(c => (
              <div key={c.fp} className="grid gap-1">
                <StatusLine level="warn">{t("set.sharedKeyChanged", { name: c.name })}</StatusLine>
                {vault.role === "admin" ? (
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
          </>
        ) : (
          <span className="text-xs text-s-muted">{t("set.sharedNever")}</span>
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

      {link ? (
        <div className="grid gap-1.5">
          <span className={LABEL}>{t("set.sharedLink", { role: roleName(link.invite.role) })}</span>
          <CommandBlock hint={t("set.sharedLinkHelp", { time: until(link.invite.expires) })} command={link.link} wrap />
          <div>
            <button className={`${buttonClass("ghost")} -ml-3`} onClick={() => closeInvite(vault.id)}>
              {t("set.sharedDone")}
            </button>
          </div>
        </div>
      ) : inviting ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className={LABEL}>{t("set.sharedInviteAs")}</span>
          <Segmented label={t("set.sharedInviteAs")} options={roles} value={role} onPick={setRole} />
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

      {membersOpen ? (
        <div className="grid min-w-0 gap-1.5">
          <span className={LABEL}>{t("set.sharedMembers")}</span>
          {info ? (
            <>
              {people.map(person => (
                <div key={person.who} className="grid min-w-0 grid-cols-1 gap-0.5">
                  <div className="flex min-h-7 items-center gap-2">
                    <span
                      className="min-w-0 truncate text-xs font-medium text-s-fg"
                      title={person.email ? `${person.name} · ${person.email}` : person.name}
                    >
                      {person.name}
                      {person.email ? <span className="font-normal text-s-muted"> · {person.email}</span> : null}
                    </span>
                    <span className="flex-1"></span>
                    {removingPerson === person.who ? (
                      <>
                        <span className="text-xs text-s-muted">
                          {person.who === myself?.who
                            ? t("set.sharedRemoveSelfSure")
                            : t("set.sharedRemovePersonSure", { name: person.name })}
                        </span>
                        <button
                          className={buttonClass("dangerSolid")}
                          disabled={busy}
                          aria-label={t("set.extraVaultRemove", { name: person.name })}
                          onClick={async () => {
                            await removePerson(vault.id, person.who);
                            setRemovingPerson("");
                          }}
                        >
                          {t("ag.remove")}
                        </button>
                        <button className={buttonClass("ghost")} onClick={() => setRemovingPerson("")}>
                          {t("mc.cancel")}
                        </button>
                      </>
                    ) : (
                      <>
                        {own && person.who === myself?.who && !link ? (
                          <button
                            className={buttonClass("ghost")}
                            disabled={busy}
                            onClick={() => inviteToShared(vault.id, "member", person.who)}
                          >
                            {t("set.sharedAddDevice")}
                          </button>
                        ) : null}
                        {status?.admin ? (
                          <button
                            className={buttonClass("ghost")}
                            disabled={busy}
                            onClick={() => startNaming(person.who, "", person.name, person.email)}
                          >
                            {t("set.sharedRename")}
                          </button>
                        ) : null}
                        {status?.admin || (own && person.who === myself?.who) ? (
                          <button
                            className={buttonClass("ghost")}
                            aria-label={t("set.extraVaultRemove", { name: person.name })}
                            onClick={() => setRemovingPerson(person.who)}
                          >
                            {t("ag.remove")}
                          </button>
                        ) : null}
                      </>
                    )}
                  </div>
                  {naming?.who === person.who && !naming.fp ? nameForm : null}
                  {person.devices.flatMap(fp => info.vault.members.filter(m => m.fp === fp)).map(m => device(m, true))}
                </div>
              ))}
              {people.length && loose.length ? <span className={LABEL}>{t("set.sharedNoPerson")}</span> : null}
              {loose.map(m => device(m, false))}
              {/* an admin's every open invite, a member's its own (for its devices) */}
              {info.vault.invites.length ? (
                <>
                  <span className={LABEL}>{t("set.sharedInvites")}</span>
                  {info.vault.invites.map(invite => (
                    <div key={invite.id} className="flex min-h-7 items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-xs text-s-muted">
                        {t("set.sharedInviteOpen", { role: roleName(invite.role), time: until(invite.expires) })}
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
                </>
              ) : null}
            </>
          ) : (
            <span className="text-xs text-s-muted">{t("set.sharedAsking")}</span>
          )}
        </div>
      ) : null}
      {message ? <span className={message.ok ? HINT_IN_ROW : ERROR_MESSAGE}>{message.text}</span> : null}
    </div>
  );
}

/** Under a machine (`machine` its id) New workspace on this machine…, in Workspaces ("") Join a workspace with a link…, or
 *  the form it opened. The one form and its message show where `form.machine` says. */
function SharedForm({ machine }: { machine: string }) {
  const { t } = useT();
  const form = useSettingsStore(s => (s.shared.form.machine === machine ? s.shared.form : null));
  const message = useSettingsStore(s => (s.shared.form.machine === machine ? s.shared.messages.form : null));
  const busy = useSettingsStore(s => !!s.shared.busy.form);
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
        <Field label={t("set.sharedNoHistory")} hint={t("set.sharedNoHistoryHelp")} id="shared-nohistory">
          <input
            id="shared-nohistory"
            type="checkbox"
            checked={form.noHistory}
            onChange={e => editForm({ noHistory: e.target.checked })}
          />
        </Field>
        {footer(t("set.sharedCreate"), busy || !form.name.trim() || !form.folder, createSharedVault)}
      </div>
    );
  if (form?.mode === "join") {
    const { sso, login } = form;
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
        {sso ? <SsoSignIn sso={sso} login={login ?? null} /> : null}
        {folder}
        {footer(
          t("set.sharedJoinButton"),
          busy || !form.link.trim() || !form.folder || (!!sso?.required && !login),
          joinSharedVault,
        )}
      </div>
    );
  }
  // a create or join that ends closes the form: what its reload said shows here
  return (
    <div className={`flex flex-wrap items-center gap-2 ${EDGE}`}>
      <button className={buttonClass()} disabled={busy} onClick={() => openForm(machine ? "new" : "join", machine)}>
        {t(machine ? "set.sharedNew" : "set.sharedJoin")}
      </button>
      {message ? <span className={message.ok ? HINT_IN_ROW : ERROR_MESSAGE}>{message.text}</span> : null}
    </div>
  );
}

/** The join form's sign-in (docs/workspaces.md, SSO): the server of the link asks devices to sign in with its provider
 *  before they join. "Sign in with Google" opens the browser, then who signed in shows above the usual Join. */
function SsoSignIn({ sso, login }: { sso: Sso; login: SsoLogin | null }) {
  const { t } = useT();
  const signing = useSettingsStore(s => !!s.shared.busy.sso);
  const provider = sso.issuer === GOOGLE_ISSUER ? "Google" : sso.issuer.replace(/^https:\/\//, "");
  return (
    <Field
      label={t("set.ssoJoinLabel")}
      hint={t(sso.required ? "set.ssoJoinRequired" : "set.ssoJoinOptional", { domains: sso.domains.join(", ") })}
    >
      {login ? (
        <span className="text-xs text-s-fg">{t("set.ssoSignedInAs", { email: login.email ?? "?" })}</span>
      ) : null}
      {signing ? (
        <>
          <span className="text-xs text-s-muted">{t("set.ssoWaiting")}</span>
          <button className={buttonClass("ghost")} onClick={ssoCancel}>
            {t("mc.cancel")}
          </button>
        </>
      ) : (
        <button className={buttonClass(login ? "ghost" : "primary")} onClick={() => void ssoSignIn()}>
          {t(login ? "set.ssoSignInAgain" : "set.ssoSignIn", { provider })}
        </button>
      )}
    </Field>
  );
}
