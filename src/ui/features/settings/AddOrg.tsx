import { useState, type ReactNode } from "react";
import { orgInstallCommands, recogniseLine, type OrgDraft } from "../../../domain/settings/servers";
import { connectOrg, dropDraft, editDraft, openServers } from "../../../application/settings/servers";
import { useSettingsStore } from "../../../application/settings/store";
import { cancelSignIn } from "../../../application/settings/teams";
import { Html } from "../../components/Html";
import { Icon } from "../../components/Icon";
import { useT } from "../../hooks/useT";
import { buttonClass, ERROR_MESSAGE, FIELD, HINT } from "./blocks";
import { ConnectHelp } from "./ConnectHelp";
import { CopyButton } from "./CopyButton";
import { CommandBlock } from "./MachineSetup";
import { Steps } from "./Steps";
import { TrustBadge } from "./TrustBadge";
import { WhereTag } from "./WhereTag";

const CARD = "grid min-w-0 gap-3 rounded-xl border border-s-border bg-raised px-4 py-3.5";
const H2 = "text-[13px] font-semibold text-s-fg";

/** A server for an organisation, set up over days: the values every command takes and who does what (step 2), the
 *  commands for the box from docs/relay-server.md (3), then the link it printed to log in here (4). What is typed and
 *  the step stay on this Mac until it is connected (Save and close). */
export function AddOrg() {
  const { t } = useT();
  const draft = useSettingsStore(s => s.serversPage.draft);
  if (!draft) return null;
  return (
    <>
      <header className="grid gap-3">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-xl font-semibold text-s-fg">{t("srv.kindOrgServer")}</h1>
          <div className="flex gap-2">
            <button className={buttonClass("ghost")} onClick={dropDraft}>
              {t("srv.stopSetup")}
            </button>
            <button className={buttonClass()} onClick={() => openServers("mac")}>
              {t("srv.saveClose")}
            </button>
          </div>
        </div>
        <Steps
          steps={[t("srv.stepFor"), t("srv.stepNeeds"), t("srv.stepInstall"), t("srv.stepConnect")]}
          at={draft.step}
        />
      </header>
      {draft.step === 2 ? <Needs draft={draft} /> : draft.step === 3 ? <Install draft={draft} /> : <Connect />}
    </>
  );
}

function Nav({ back, next, label }: { back?: () => void; next?: () => void; label?: string }) {
  const { t } = useT();
  return (
    <div className="flex items-center justify-end gap-2">
      {back ? (
        <button className={buttonClass("ghost")} onClick={back}>
          {t("srv.back")}
        </button>
      ) : null}
      {next ? (
        <button className={buttonClass("primary")} onClick={next}>
          {label ?? t("srv.continue")}
        </button>
      ) : null}
    </div>
  );
}

/** The commands as plain text with the values filled in, for a mail or a ticket to whoever runs the box. */
function instructions(t: ReturnType<typeof useT>["t"], d: OrgDraft) {
  const c = orgInstallCommands(d);
  return [
    t("srv.textTitle", { host: d.host || "relay.example.com" }),
    "",
    `1. ${t("srv.installDocker")}`,
    c.check,
    "",
    `2. ${t("srv.installLogin")}`,
    c.login,
    "",
    `3. ${t("srv.installStart")}`,
    c.install,
    "",
    `4. ${t("srv.installPort")}`,
    c.port,
    "",
    `5. ${t("srv.installDns", { host: d.host || "relay.example.com" })}`,
    "",
    `6. ${t("srv.installTeam")}`,
    c.team,
    "",
    `7. ${t("srv.installBackup")}`,
    c.cron,
  ].join("\n");
}

function Needs({ draft }: { draft: OrgDraft }) {
  const { t } = useT();
  const version = useSettingsStore(s => s.machinesPage.setup?.version ?? "");
  const field = (key: keyof OrgDraft, label: string, help: string, placeholder: string, type = "text") => (
    <div className="grid content-start gap-1">
      <label htmlFor={`org-${key}`} className="text-xs font-medium text-s-fg">
        {label}
      </label>
      <input
        id={`org-${key}`}
        className={`${FIELD} w-full font-mono text-xs`}
        type={type}
        spellCheck={false}
        placeholder={placeholder}
        value={String(draft[key])}
        onChange={e => editDraft({ [key]: e.target.value })}
      />
      <span className={HINT}>{help}</span>
    </div>
  );
  const ready = !!draft.host.trim() && draft.admin.includes("@");
  return (
    <>
      <div className="grid min-w-0 grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        <div className="grid min-w-0 gap-5">
          <section className={CARD}>
            <h2 className={H2}>{t("srv.aboutServer")}</h2>
            <div className="grid gap-4 md:grid-cols-2">
              {field("host", t("srv.fieldHost"), t("srv.fieldHostHelp"), "relay.example.com")}
              {field("admin", t("srv.fieldAdmin"), t("srv.fieldAdminHelp"), "you@example.com", "email")}
              {field("folder", t("srv.fieldFolder"), t("srv.fieldFolderHelp"), "/opt/relay-server")}
              {field("network", t("srv.fieldNetwork"), t("srv.fieldNetworkHelp"), "192.168.1.0/24")}
            </div>
          </section>
          <section className={CARD}>
            <div className="flex items-baseline justify-between gap-3">
              <h2 className={H2}>{t("srv.whoWhat")}</h2>
              <span className="text-xs text-s-muted">{t("srv.whoWhatTime")}</span>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid content-start gap-2">
                <span className="flex items-center gap-2 text-xs font-medium text-s-fg">
                  <WhereTag where="box" />
                  {t("srv.techPerson")}
                </span>
                <ol className="grid list-decimal gap-1 pl-4 text-xs text-s-fg">
                  <li>{t("srv.installDocker")}</li>
                  <li>{t("srv.techStart", { folder: draft.folder })}</li>
                  <li>{t("srv.techPort", { network: draft.network || "…" })}</li>
                  <li>{t("srv.installDns", { host: draft.host || "…" })}</li>
                  <li>{t("srv.techTeam", { admin: draft.admin || "…" })}</li>
                  <li>{t("srv.installBackup")}</li>
                  <li>{t("srv.techLater")}</li>
                </ol>
              </div>
              <div className="grid content-start gap-2">
                <span className="flex items-center gap-2 text-xs font-medium text-s-fg">
                  <WhereTag where="relay" />
                  {t("srv.youCap")}
                </span>
                <ol className="grid list-decimal gap-1 pl-4 text-xs text-s-fg">
                  <li>{t("srv.youPaste")}</li>
                  <li>{t("srv.youSignIn")}</li>
                  <li>{t("srv.youWorkspace")}</li>
                  <li>{t("srv.youInvite")}</li>
                  <li>{t("srv.youSecondAdmin")}</li>
                </ol>
              </div>
            </div>
          </section>
          <p className="flex flex-wrap items-start gap-2.5 rounded-xl border border-s-border bg-raised px-3.5 py-3 text-xs text-s-fg">
            <TrustBadge kind="org" name={t("srv.theOrg")} />
            <span className="min-w-0 flex-1">{t("srv.trustBefore")}</span>
          </p>
        </div>
        <div className="grid min-w-0 gap-5">
          <section className={CARD}>
            <h2 className={H2}>{t("srv.youNeed")}</h2>
            <ul className="grid list-disc gap-1 pl-4 text-xs text-s-fg">
              <li>{t("srv.needBox")}</li>
              <li>{t("srv.needDocker")}</li>
              <li>{t("srv.needPort")}</li>
              <li>{t("srv.needDns")}</li>
              <li>{t("srv.needHttpsOrg")}</li>
              {version ? <li>{t("srv.needVersion", { version })}</li> : null}
            </ul>
          </section>
          <section className={CARD}>
            <h2 className={H2}>{t("srv.forSomeoneElse")}</h2>
            <span className="text-xs text-s-muted">{t("srv.forSomeoneElseHelp")}</span>
            <CopyButton label={t("srv.copyInstructions")} text={instructions(t, draft)} />
          </section>
        </div>
      </div>
      {ready ? null : <span className={`${HINT} text-right`}>{t("srv.fillFirst")}</span>}
      <Nav next={ready ? () => editDraft({ step: 3 }) : undefined} />
    </>
  );
}

function Install({ draft }: { draft: OrgDraft }) {
  const { t, th } = useT();
  const c = orgInstallCommands(draft);
  const step = (n: number, title: string, children: ReactNode) => (
    <li className="grid grid-cols-[1.5rem_1fr] gap-2 border-t border-s-border py-3 first:border-t-0">
      <span className="grid size-5 place-items-center rounded-full bg-s-mutedbg text-[11px] font-semibold text-s-fg">
        {n}
      </span>
      <div className="grid min-w-0 gap-2">
        <span className="text-[13px] font-medium text-s-fg">{title}</span>
        {children}
      </div>
    </li>
  );
  return (
    <>
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-s-border bg-raised px-3.5 py-2.5 text-xs">
        <WhereTag where="box" />
        <span className="min-w-0 flex-1 text-s-muted">
          {t("srv.valuesLine", {
            host: draft.host,
            admin: draft.admin,
            folder: draft.folder,
            network: draft.network || "…",
          })}
        </span>
        <button className={buttonClass("ghost")} onClick={() => editDraft({ step: 2 })}>
          {t("srv.edit")}
        </button>
        <CopyButton label={t("srv.copyInstructions")} text={instructions(t, draft)} />
      </div>
      <ol className="grid rounded-xl border border-s-border bg-raised px-4 py-1">
        {step(1, t("srv.installDocker"), <CommandBlock hint={t("srv.installDockerHelp")} command={c.check} />)}
        {step(2, t("srv.installLogin"), <CommandBlock hint={t("srv.installLoginHelp")} command={c.login} />)}
        {step(
          3,
          t("srv.installStart"),
          <>
            <CommandBlock hint={t("srv.installStartHelp")} command={c.install} />
            <Html className={HINT} html={th("srv.installHealthy")} />
            <Html className={HINT} html={th("srv.installFails")} />
          </>,
        )}
        {step(4, t("srv.installPort"), <CommandBlock hint={t("srv.installPortHelp")} command={c.port} />)}
        {step(5, t("srv.installDns", { host: draft.host }), <span className={HINT}>{t("srv.installDnsHelp")}</span>)}
        {step(
          6,
          t("srv.installTeam"),
          <>
            <CommandBlock hint={t("srv.installTeamHelp", { admin: draft.admin })} command={c.team} wrap />
            <span className={HINT}>{t("srv.installTeamRefuses")}</span>
          </>,
        )}
        {step(7, t("srv.installBackup"), <CommandBlock hint={t("srv.installBackupHelp")} command={c.cron} wrap />)}
      </ol>
      <div className="flex items-center justify-end gap-3">
        <span className="flex items-center gap-1.5 text-xs text-s-muted">
          <span className="size-1.5 rounded-full bg-s-warn" />
          {t("srv.waitingLink")}
        </span>
        <Nav back={() => editDraft({ step: 2 })} next={() => editDraft({ step: 4 })} label={t("srv.haveLink")} />
      </div>
    </>
  );
}

/** Step 4: the link the team command printed, Log in. The organisation's page opens with what is left to set up. */
function Connect() {
  const { t } = useT();
  const busy = useSettingsStore(s => !!s.shared.busy.team);
  const message = useSettingsStore(s => s.shared.messages.team);
  const [line, setLine] = useState("");
  const seen = recogniseLine(line);
  return (
    <>
      <section className={CARD}>
        <label htmlFor="org-link" className={H2}>
          {t("set.teamLink")}
        </label>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <input
            id="org-link"
            className={`${FIELD} min-w-0 flex-1 basis-64 font-mono text-xs`}
            placeholder="relay://…#team&fp=…&invite=…"
            spellCheck={false}
            value={line}
            onChange={e => setLine(e.target.value)}
          />
          {busy ? (
            <>
              <span className="text-xs text-s-muted">{t("set.teamSigningIn")}</span>
              <button className={buttonClass("ghost")} onClick={cancelSignIn}>
                {t("mc.cancel")}
              </button>
            </>
          ) : (
            <button
              className={buttonClass("primary")}
              disabled={seen?.kind !== "team-invite" && seen?.kind !== "team-signin"}
              onClick={() => void connectOrg(line.trim())}
            >
              {t("set.teamLogin")}
            </button>
          )}
        </div>
        {seen && seen.kind !== "team-invite" && seen.kind !== "team-signin" ? (
          <span className="text-xs text-s-warn">{t("srv.seenNotTeam")}</span>
        ) : seen ? (
          <span className="flex items-center gap-1.5 text-xs text-s-ok">
            <Icon name="check" className="glyph size-3.5 stroke-2" />
            {t("srv.seenTeam", { host: seen.host })}
          </span>
        ) : (
          <span className={HINT}>{t("srv.connectHelp")}</span>
        )}
        {message && !message.ok ? <span className={ERROR_MESSAGE}>{message.text}</span> : null}
      </section>
      <section className={CARD}>
        <h2 className={H2}>{t("srv.afterConnect")}</h2>
        <span className="text-xs text-s-muted">{t("srv.afterConnectHelp")}</span>
      </section>
      <ConnectHelp />
      <Nav back={() => editDraft({ step: 3 })} />
    </>
  );
}
