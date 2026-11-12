import { useEffect, useState, type ReactNode } from "react";
import { recogniseLine } from "../../../domain/settings/servers";
import { connectOrg, joinWorkspace, openAdd, pairOwnMachine } from "../../../application/settings/servers";
import { editForm, pickSharedFolder } from "../../../application/settings/shared-vaults";
import { useSettingsStore } from "../../../application/settings/store";
import { cancelSignIn, peekTeam } from "../../../application/settings/teams";
import { Icon } from "../../components/Icon";
import { useT } from "../../hooks/useT";
import { buttonClass, ERROR_MESSAGE, FIELD, HINT } from "./blocks";
import { ConnectHelp } from "./ConnectHelp";
import { PathField } from "./PathField";
import { Steps } from "./Steps";
import { TrustBadge } from "./TrustBadge";

const CARD = "grid min-w-0 gap-3 rounded-xl border border-s-border bg-raised px-4 py-3.5";
const KEY = "text-xs text-s-muted";

/** Join a server someone else runs: one field for any line someone sent. Relay says what it is (an invite to an
 *  organisation, the organisation's sign-in link, an invite to an encrypted workspace, or a pairing line) and what
 *  you get and who can read it, before anything happens. An invite link that opened Relay is already in it. */
export function AddJoin() {
  const { t } = useT();
  const line = useSettingsStore(s => s.shared.form.link);
  const seen = recogniseLine(line);
  return (
    <>
      <header className="grid gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="grid gap-1">
            <h1 className="text-xl font-semibold text-s-fg">{t("srv.joinTitle")}</h1>
            <p className={HINT}>{t("srv.joinHelp")}</p>
          </div>
          <button className={buttonClass("ghost")} onClick={() => openAdd()}>
            {t("mc.cancel")}
          </button>
        </div>
        <Steps steps={[t("srv.stepFor"), t("srv.stepPaste")]} at={2} />
      </header>
      <section className={CARD}>
        <label htmlFor="join-line" className="text-[13px] font-semibold text-s-fg">
          {t("srv.joinLine")}
        </label>
        <textarea
          id="join-line"
          className={`${FIELD} h-auto w-full py-1.5 font-mono text-xs`}
          rows={2}
          spellCheck={false}
          placeholder="relay://…"
          value={line}
          onChange={e => editForm({ link: e.target.value })}
        />
        {!line.trim() ? null : seen ? (
          <Recognised line={line.trim()} kind={seen.kind} host={seen.host} />
        ) : (
          <span className={ERROR_MESSAGE}>{t("srv.notALine")}</span>
        )}
      </section>
      <section className={CARD}>
        <h2 className="text-[13px] font-semibold text-s-fg">{t("srv.threeKinds")}</h2>
        <dl className="grid gap-2.5 text-xs md:grid-cols-3">
          {(
            [
              ["srv.kindTeamInvite", "srv.kindTeamInviteHelp", "relay://host:47800#team&fp=…&invite=…"],
              ["srv.kindWorkspace", "srv.kindWorkspaceHelp", "relay://host:47800#fp=…&vault=…&invite=…"],
              ["srv.kindPairing", "srv.kindPairingHelp", "relay://host:47800#fp=…&code=…"],
            ] as const
          ).map(([name, help, form]) => (
            <div key={name} className="grid content-start gap-1">
              <dt className="font-medium text-s-fg">{t(name)}</dt>
              <dd className="text-s-muted">{t(help)}</dd>
              <dd className="truncate font-mono text-[11px] text-s-faint">{form}</dd>
            </div>
          ))}
        </dl>
      </section>
      <ConnectHelp />
    </>
  );
}

/** What the pasted line is, what you get and who reads it, and its one action. */
function Recognised({
  line,
  kind,
  host,
}: {
  line: string;
  kind: "team-invite" | "team-signin" | "workspace" | "pairing";
  host: string;
}) {
  const { t } = useT();
  const teamBusy = useSettingsStore(s => !!s.shared.busy.team);
  const teamMessage = useSettingsStore(s => s.shared.messages.team);
  const formBusy = useSettingsStore(s => !!s.shared.busy.form);
  const formMessage = useSettingsStore(s => s.shared.messages.form);
  const folder = useSettingsStore(s => s.shared.form.folder);
  const pairing = useSettingsStore(s => s.machinesPage.pairing);
  const pairError = useSettingsStore(s => s.machinesPage.pairError);
  const [name, setName] = useState("");
  const [sharedOnly, setSharedOnly] = useState(false);
  const team = kind === "team-invite" || kind === "team-signin";
  // an organisation's link: its server says its name before anything else happens (the host until it answers)
  const peek = useSettingsStore(s => (s.team.peek?.link === line ? s.team.peek : null));
  useEffect(() => {
    if (team) void peekTeam(line);
  }, [team, line]);
  const org = peek?.name || host;
  const row = (key: string, value: ReactNode) => (
    <>
      <dt className={KEY}>{key}</dt>
      <dd className="text-xs text-s-fg">{value}</dd>
    </>
  );
  return (
    <div className="grid gap-3 rounded-lg bg-s-mutedbg/40 px-3.5 py-3">
      <span className="flex items-center gap-1.5 text-[13px] font-medium text-s-fg">
        <Icon name="check" className="glyph size-3.5 stroke-2 text-s-ok" />
        {t(
          kind === "team-invite"
            ? "srv.kindTeamInvite"
            : kind === "team-signin"
              ? "srv.kindTeamSignIn"
              : kind === "workspace"
                ? "srv.kindWorkspace"
                : "srv.kindPairing",
        )}
        <span className="font-mono text-xs font-normal text-s-muted">{host}</span>
      </span>
      {kind === "team-invite" && peek?.name ? (
        <span className="text-base font-semibold text-s-fg">{t("srv.invitedYou", { name: peek.name })}</span>
      ) : null}
      <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-2">
        {team
          ? row(t("srv.youGet"), t(kind === "team-invite" ? "srv.getTeamInvite" : "srv.getTeamSignIn", { host: org }))
          : kind === "workspace"
            ? row(t("srv.youGet"), t("srv.getWorkspace"))
            : row(t("srv.youGet"), t("srv.getPairing"))}
        {row(
          t("srv.whoCanReadIt"),
          team ? (
            <span className="grid justify-items-start gap-1">
              <TrustBadge kind="org" name={org} />
              {t("srv.readsTeam")}
            </span>
          ) : (
            <span className="grid justify-items-start gap-1">
              <TrustBadge kind="e2e" />
              {t(kind === "workspace" ? "srv.readsWorkspace" : "srv.readsPairing")}
            </span>
          ),
        )}
        {team ? row(t("srv.staysHere"), t("srv.staysHereHelp")) : null}
      </dl>
      {team ? (
        <div className="flex flex-wrap items-center gap-2">
          {teamMessage && !teamMessage.ok ? <span className={ERROR_MESSAGE}>{teamMessage.text}</span> : null}
          <span className="flex-1" />
          {teamBusy ? (
            <>
              <span className="text-xs text-s-muted">{t("set.teamSigningIn")}</span>
              <button className={buttonClass("ghost")} onClick={cancelSignIn}>
                {t("mc.cancel")}
              </button>
            </>
          ) : (
            <button className={buttonClass("primary")} onClick={() => void connectOrg(line)}>
              {t(kind === "team-invite" ? "set.teamLogin" : "srv.signInOrg")}
            </button>
          )}
        </div>
      ) : kind === "workspace" ? (
        <div className="grid gap-2">
          <span className="text-xs font-medium text-s-fg">{t("set.sharedFolder")}</span>
          <PathField
            value={folder}
            tip={folder}
            readOnly
            placeholder={t("vault.none")}
            pickTip={t("vault.pickPath")}
            onPick={pickSharedFolder}
          />
          <span className={HINT}>{t("set.sharedJoinFolderHelp")}</span>
          <div className="flex flex-wrap items-center gap-2">
            {formMessage && !formMessage.ok ? <span className={ERROR_MESSAGE}>{formMessage.text}</span> : null}
            <span className="flex-1" />
            <button
              className={buttonClass("primary")}
              disabled={formBusy || !folder}
              onClick={() => void joinWorkspace(line)}
            >
              {t("set.sharedJoinButton")}
            </button>
          </div>
        </div>
      ) : (
        <div className="grid gap-2">
          <label htmlFor="join-name" className="text-xs font-medium text-s-fg">
            {t("mc.name")}
          </label>
          <input
            id="join-name"
            className={`${FIELD} w-80`}
            placeholder={t("mc.namePh")}
            value={name}
            onChange={e => setName(e.target.value)}
          />
          <label className="flex items-start gap-2.5">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={sharedOnly}
              onChange={e => setSharedOnly(e.target.checked)}
            />
            <span className="grid gap-0.5">
              <span className="text-xs text-s-fg">{t("mc.sharedOnly")}</span>
              <span className="text-xs text-s-muted">{t("srv.sharedOnlyHelp")}</span>
            </span>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {pairError ? <span className={ERROR_MESSAGE}>{pairError}</span> : null}
            <span className="flex-1" />
            <button
              className={buttonClass("primary")}
              disabled={pairing}
              onClick={() => void pairOwnMachine(line, name.trim(), sharedOnly)}
            >
              {pairing ? t("mc.pairing") : t("mc.pair")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
