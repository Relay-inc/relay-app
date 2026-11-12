import { useState, type ReactNode } from "react";
import type { TeamServer, TeamSso } from "../../../domain/settings/types";
import { ENTRA, GOOGLE_ISSUER } from "../../../domain/settings/types";
import { useSettingsStore } from "../../../application/settings/store";
import { setTeamSso } from "../../../application/settings/teams";
import { openLink } from "../../../application/settings/window";
import { Html } from "../../components/Html";
import { Icon } from "../../components/Icon";
import { useT } from "../../hooks/useT";
import { BUTTON_GLYPH, buttonClass, ERROR_MESSAGE, FIELD, HINT } from "./blocks";
import { CommandBlock } from "./MachineSetup";

type Provider = "" | "google" | "entra";
const providerOf = (sso: TeamSso | null | undefined): Provider =>
  !sso ? "" : sso.issuer.startsWith(ENTRA) ? "entra" : "google";
const NAMES: Record<Provider, string> = { "": "", google: "Google", entra: "Microsoft Entra" };
const GOOGLE_CONSOLE = "https://console.cloud.google.com/apis/credentials";
const ENTRA_CENTER = "https://entra.microsoft.com/";
const CARD = "grid min-w-0 gap-1.5 rounded-xl border border-s-border bg-raised px-3.5 py-3";

/** Sign-in: invite links only, Google or one Microsoft Entra tenant, as a choice of three. Under the one picked the
 *  steps in the provider's console, each field where its value is found, then Save. Beside them who does this, what
 *  the server needs and what changes for people. One sign-in at a time: saving another turns the current one off. */
export function OrgSignIn({ team }: { team: TeamServer }) {
  const { t, th } = useT();
  const o = useSettingsStore(s => s.team.overview[team.fp]);
  const busy = useSettingsStore(s => !!s.shared.busy[`team:${team.fp}`]);
  const message = useSettingsStore(s => s.shared.messages[`team:${team.fp}`]);
  const sso = o?.sso ?? null;
  const current = providerOf(sso);
  const [provider, setProvider] = useState<Provider>(current);
  const [client, setClient] = useState(sso?.client ?? "");
  const [tenant, setTenant] = useState(current === "entra" ? sso!.issuer.slice(ENTRA.length, -5) : "");
  const [domains, setDomains] = useState(sso?.domains.join(", ") ?? "");
  if (!o) return <span className="text-xs text-s-muted">{t("set.sharedAsking")}</span>;
  const pick = (next: Provider) => {
    setProvider(next);
    // another provider's client id is no use here
    if (next !== current) setClient("");
    else setClient(sso?.client ?? "");
  };
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
  const ready =
    provider === ""
      ? current !== ""
      : provider === "entra"
        ? !!client.trim() && !!tenant.trim()
        : !!client.trim() && !!domains.trim();
  const option = (id: Provider, title: string, help: string) => (
    <label
      className={`flex cursor-default items-start gap-2.5 rounded-xl border p-3 ${provider === id ? "border-s-primary ring-1 ring-s-primary" : "border-s-border"}`}
    >
      <input type="radio" name="signin" className="mt-0.5" checked={provider === id} onChange={() => pick(id)} />
      <span className="grid gap-1">
        <span className="text-[13px] font-medium text-s-fg">{title}</span>
        <span className="text-xs text-s-muted">{help}</span>
        {current === id ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-s-ok">
            <span className="size-1.5 rounded-full bg-s-ok" />
            {id === "google" && sso?.domains.length
              ? t("srv.onDomains", { domains: sso.domains.join(", ") })
              : t("srv.on")}
          </span>
        ) : provider === id && current ? (
          <span className="text-xs text-s-warn">
            {t("srv.turnsOff", { provider: NAMES[current] || t("set.orgSsoNone") })}
          </span>
        ) : null}
      </span>
    </label>
  );
  const step = (n: number, title: string, body: ReactNode) => (
    <li className="grid grid-cols-[1.5rem_1fr] gap-2 border-t border-s-border py-3 first:border-t-0">
      <span className="grid size-5 place-items-center rounded-full bg-s-mutedbg text-[11px] font-semibold text-s-fg">
        {n}
      </span>
      <div className="grid min-w-0 gap-1.5">
        <span className="text-[13px] font-medium text-s-fg">{title}</span>
        {body}
      </div>
    </li>
  );
  const field = (id: string, label: string, value: string, set: (v: string) => void, placeholder = "") => (
    <div className="grid gap-1">
      <label htmlFor={id} className="text-xs text-s-muted">
        {label}
      </label>
      <input
        id={id}
        className={`${FIELD} w-full font-mono text-xs`}
        spellCheck={false}
        placeholder={placeholder}
        value={value}
        onChange={e => set(e.target.value)}
      />
    </div>
  );
  const saveRow = (
    <div className="flex flex-wrap items-center gap-3">
      <button className={buttonClass("primary")} disabled={busy || !ready} onClick={() => void save()}>
        {provider === ""
          ? t("srv.saveInviteOnly")
          : current && current !== provider
            ? t("srv.saveSwitch", { provider: NAMES[current] })
            : t("set.ssoSave")}
      </button>
      {provider ? <span className="text-xs text-s-muted">{t("srv.noSecret")}</span> : null}
      {message && !message.ok ? <span className={ERROR_MESSAGE}>{message.text}</span> : null}
    </div>
  );
  return (
    <div className="grid min-w-0 gap-5">
      <div className="grid gap-3 md:grid-cols-3">
        {option("", t("set.orgSsoNone"), t("srv.inviteOnlyHelp"))}
        {option("google", "Google", t("srv.googleHelp"))}
        {option("entra", "Microsoft Entra", t("srv.entraHelp"))}
      </div>
      <div className="grid min-w-0 grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        <section className={CARD}>
          {provider === "" ? (
            <>
              <h2 className="text-[13px] font-semibold text-s-fg">{t("set.orgSsoNone")}</h2>
              <span className="text-xs text-s-muted">{t("srv.inviteOnlyMore")}</span>
              {current ? saveRow : null}
            </>
          ) : provider === "google" ? (
            <>
              <h2 className="text-[13px] font-semibold text-s-fg">{t("srv.setUpGoogle")}</h2>
              <ol className="grid">
                {step(
                  1,
                  t("srv.googleStep1"),
                  <>
                    <span className="text-xs text-s-muted">{t("srv.googleStep1Help")}</span>
                    <button className={`${buttonClass()} justify-self-start`} onClick={() => openLink(GOOGLE_CONSOLE)}>
                      console.cloud.google.com
                      <Icon name="out" className={BUTTON_GLYPH} />
                    </button>
                  </>,
                )}
                {step(2, t("srv.googleStep2"), <Html className={HINT} html={th("srv.googleStep2Help")} />)}
                {step(3, t("srv.googleStep3"), <Html className={HINT} html={th("srv.googleStep3Help")} />)}
                {step(
                  4,
                  t("srv.pasteClient"),
                  field("google-client", t("set.ssoClient"), client, setClient, "….apps.googleusercontent.com"),
                )}
                {step(
                  5,
                  t("srv.googleStep5"),
                  <>
                    {field("google-domains", t("set.ssoDomains"), domains, setDomains, "example.com")}
                    <span className={HINT}>{t("srv.googleDomainsHelp")}</span>
                  </>,
                )}
                {step(6, t("srv.save"), saveRow)}
              </ol>
            </>
          ) : (
            <>
              <h2 className="text-[13px] font-semibold text-s-fg">{t("srv.setUpEntra")}</h2>
              <ol className="grid">
                {step(
                  1,
                  t("srv.entraStep1"),
                  <>
                    <Html className={HINT} html={th("srv.entraStep1Help")} />
                    <button className={`${buttonClass()} justify-self-start`} onClick={() => openLink(ENTRA_CENTER)}>
                      entra.microsoft.com
                      <Icon name="out" className={BUTTON_GLYPH} />
                    </button>
                  </>,
                )}
                {step(
                  2,
                  t("srv.entraStep2"),
                  <CommandBlock hint={t("srv.entraStep2Help")} command="http://localhost" />,
                )}
                {step(
                  3,
                  t("srv.entraStep3"),
                  <>
                    <span className={HINT}>{t("srv.entraStep3Help")}</span>
                    {field(
                      "entra-client",
                      t("srv.entraClient"),
                      client,
                      setClient,
                      "00000000-0000-0000-0000-000000000000",
                    )}
                  </>,
                )}
                {step(
                  4,
                  t("srv.entraStep4"),
                  <>
                    <span className={HINT}>{t("srv.entraStep4Help")}</span>
                    {field(
                      "entra-tenant",
                      t("set.ssoTenant"),
                      tenant,
                      setTenant,
                      "00000000-0000-0000-0000-000000000000",
                    )}
                  </>,
                )}
                {step(5, t("srv.save"), saveRow)}
              </ol>
            </>
          )}
        </section>
        <div className="grid min-w-0 gap-3">
          {provider ? (
            <>
              <Note title={t("srv.whoDoesThis")}>{t("srv.whoDoesThisHelp", { provider: NAMES[provider] })}</Note>
              <Note title={t("srv.serverNeeds")}>
                {t("srv.serverNeedsHelp", { host: team.host, provider: NAMES[provider] })}
              </Note>
              <Note title={t("srv.whatChanges")}>
                {t("srv.whatChangesHelp", { provider: NAMES[provider] })}{" "}
                <b className="font-medium">{t("srv.newNeedInvite")}</b>
              </Note>
              {provider === "entra" ? <Note title={t("srv.tiedTitle")}>{t("srv.tiedHelp")}</Note> : null}
              {current && current !== provider ? (
                <Note title={t("srv.oneAtATime")}>
                  {t("srv.oneAtATimeHelp", { from: NAMES[current], to: NAMES[provider] })}
                </Note>
              ) : null}
            </>
          ) : (
            <Note title={t("srv.whatChanges")}>{t("srv.inviteOnlyChanges")}</Note>
          )}
        </div>
      </div>
    </div>
  );
}

function Note({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={CARD}>
      <h3 className="text-[13px] font-semibold text-s-fg">{title}</h3>
      <p className="text-xs leading-relaxed text-s-muted">{children}</p>
    </section>
  );
}
