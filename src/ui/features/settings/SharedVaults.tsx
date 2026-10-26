import { useState } from "react";
import type { Machine, SharedRole, SharedVault } from "../../../domain/settings/types";
import { agoParts } from "../../../domain/settings/machines";
import { useSettingsStore } from "../../../application/settings/store";
import {
  closeInvite,
  createSharedVault,
  editForm,
  inviteToShared,
  joinSharedVault,
  leaveShared,
  openForm,
  pickSharedFolder,
  removeMember,
  settleShared,
  toggleMembers,
  withdrawInvite,
} from "../../../application/settings/shared-vaults";
import { relativeFormat, sentAt } from "../../../shared/format";
import { useT } from "../../hooks/useT";
import { Select } from "../../components/Select";
import { buttonClass, ERROR_MESSAGE, FIELD, HINT_IN_ROW, PILL, SELECT } from "./blocks";
import { Field } from "./Field";
import { Footer } from "./Footer";
import { CommandBlock } from "./MachineSetup";
import { PathField } from "./PathField";
import { Section } from "./Section";
import { Segmented } from "./Segmented";
import { StatusLine } from "./StatusLine";

const NONE: SharedVault[] = [];
const NO_MACHINES: Machine[] = [];
const EDGE = "border-b border-s-border px-3.5 py-3 last:border-b-0";
const ROW = `grid min-w-0 grid-cols-1 gap-2.5 ${EDGE}`;
const LABEL = "text-xs font-medium text-s-fg";

/** Settings › General › Shared vaults: each vault with its last round, invites, members and Leave, then the forms to
 *  make one or join one with a link. */
export function SharedVaults() {
  const { t } = useT();
  const vaults = useSettingsStore(s => s.settings.sharedVaults ?? NONE);
  return (
    <Section title={t("set.extraVaults")} desc={t("set.sharedHelp")} list>
      {vaults.map(vault => (
        <SharedRow key={vault.id} vault={vault} />
      ))}
      <SharedForm />
    </Section>
  );
}

function SharedRow({ vault }: { vault: SharedVault }) {
  const { t, tn, locale } = useT();
  const status = useSettingsStore(s => s.shared.status[vault.id]);
  const info = useSettingsStore(s => s.shared.info[vault.id]);
  const membersOpen = useSettingsStore(s => vault.id in s.shared.info);
  const link = useSettingsStore(s => s.shared.links[vault.id]);
  const message = useSettingsStore(s => s.shared.messages[vault.id]);
  const busy = useSettingsStore(s => s.shared.busy);
  const [inviting, setInviting] = useState(false);
  const [role, setRole] = useState<SharedRole>("member");
  const [leaving, setLeaving] = useState(false);
  const [removing, setRemoving] = useState(""); // the member whose Remove asks first, by fingerprint
  const admin = vault.role === "admin";
  const ago = status ? agoParts(status.at) : null;
  const roleName = (role: string) => t(role === "admin" ? "set.sharedAdmin" : "set.sharedMember");
  const until = (expires: number) => sentAt(expires * 1000, locale);
  return (
    <div className={ROW}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-[13px] font-semibold text-s-fg">{vault.name}</span>
        <span className={PILL}>{roleName(vault.role)}</span>
        <span className="font-mono text-xs text-s-muted">{vault.host}</span>
        <span className="flex-1"></span>
        {admin && !inviting && !link ? (
          <button className={buttonClass("ghost")} onClick={() => setInviting(true)}>
            {t("set.sharedInvite")}
          </button>
        ) : null}
        <button
          className={buttonClass("ghost")}
          aria-expanded={membersOpen}
          disabled={busy[`${vault.id}:members`]}
          onClick={() => toggleMembers(vault.id)}
        >
          {t("set.sharedMembers")}
        </button>
        {leaving ? (
          <>
            <span className="text-xs text-s-muted">{t("set.sharedLeaveSure")}</span>
            <button
              className={buttonClass("dangerSolid")}
              disabled={busy[`${vault.id}:leave`]}
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
          <button className={buttonClass("danger")} onClick={() => setLeaving(true)}>
            {t("set.sharedLeave")}
          </button>
        )}
      </div>
      <code className="min-w-0 truncate font-mono text-xs text-s-fg" title={vault.folder}>
        {vault.folder}
      </code>
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
                    disabled={busy[`${vault.id}:held`]}
                    onClick={() => settleShared(vault.id, false, status.held)}
                  >
                    {t("set.sharedHeldRestore")}
                  </button>
                  <button
                    className={buttonClass("danger")}
                    disabled={busy[`${vault.id}:held`]}
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
            disabled={busy[`${vault.id}:invite`]}
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
        <div className="grid gap-1.5">
          <span className={LABEL}>{t("set.sharedMembers")}</span>
          {info ? (
            <>
              {info.vault.members.map(member => (
                <div key={member.fp} className="flex min-h-7 items-center gap-2">
                  <span className="min-w-0 truncate text-xs text-s-fg">
                    {member.name}
                    {member.fp === info.me ? <span className="text-s-muted"> · {t("set.sharedThisMac")}</span> : null}
                  </span>
                  <span className={PILL}>{roleName(member.role)}</span>
                  <span className="flex-1"></span>
                  {!admin || member.fp === info.me ? null : removing === member.fp ? (
                    <>
                      <span className="text-xs text-s-muted">{t("set.sharedRemoveSure")}</span>
                      <button
                        className={buttonClass("dangerSolid")}
                        disabled={busy[`${vault.id}:remove`]}
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
              ))}
              {admin && info.vault.invites.length ? (
                <>
                  <span className={LABEL}>{t("set.sharedInvites")}</span>
                  {info.vault.invites.map(invite => (
                    <div key={invite.id} className="flex min-h-7 items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-xs text-s-muted">
                        {t("set.sharedInviteOpen", { role: roleName(invite.role), time: until(invite.expires) })}
                      </span>
                      <button
                        className={buttonClass("ghost")}
                        disabled={busy[`${vault.id}:withdraw`]}
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

/** Under the list: New shared vault… and Join with a link…, or the form one of them opened. */
function SharedForm() {
  const { t } = useT();
  const form = useSettingsStore(s => s.shared.form);
  const message = useSettingsStore(s => s.shared.messages.form);
  const busy = useSettingsStore(s => s.shared.busy);
  const machines = useSettingsStore(s => s.settings.machines ?? NO_MACHINES);
  const machine = form.machine || machines[0]?.id || "";
  const folder = (
    <Field
      label={t("set.sharedFolder")}
      hint={form.mode === "join" ? t("set.sharedJoinFolderHelp") : t("set.sharedNewFolderHelp")}
    >
      <PathField
        value={form.folder}
        tip={form.folder}
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

  if (form.mode === "new" && form.recovery)
    return (
      <div className={ROW}>
        <span className={LABEL}>{t("set.sharedRecovery")}</span>
        <CommandBlock hint={t("set.sharedRecoveryHelp")} command={form.recovery} wrap />
        <div className="flex justify-end">
          <button className={buttonClass("primary")} onClick={() => openForm("")}>
            {t("set.sharedDone")}
          </button>
        </div>
      </div>
    );
  if (form.mode === "new")
    return (
      <div className={ROW}>
        <span className={LABEL}>{t("set.sharedNewTitle")}</span>
        <Field label={t("set.sharedMachine")} id="shared-machine" hint={t("set.sharedMachineHelp")}>
          {machines.length ? (
            <Select
              className={SELECT}
              id="shared-machine"
              options={machines.map(m => ({ id: m.id, name: m.name }))}
              value={machine}
              onChange={value => editForm({ machine: value })}
            />
          ) : (
            <span className="text-xs text-s-warn">{t("set.sharedNoMachine")}</span>
          )}
        </Field>
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
        {footer(t("set.sharedCreate"), busy.create || !machine || !form.name.trim() || !form.folder, () =>
          createSharedVault(machine),
        )}
      </div>
    );
  if (form.mode === "join")
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
        {footer(t("set.sharedJoinButton"), busy.join || !form.link.trim() || !form.folder, joinSharedVault)}
      </div>
    );
  return (
    <div className={`flex flex-wrap items-center gap-2 ${EDGE}`}>
      <button className={buttonClass()} onClick={() => openForm("new")}>
        {t("set.sharedNew")}
      </button>
      <button className={buttonClass()} onClick={() => openForm("join")}>
        {t("set.sharedJoin")}
      </button>
    </div>
  );
}
