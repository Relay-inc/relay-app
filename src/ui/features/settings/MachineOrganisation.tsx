import { useState } from "react";
import type { Machine, OrgOverview, OrgPerson, OrgStatus, Sso } from "../../../domain/settings/types";
import { entraIssuer, entraTenant, GOOGLE_ISSUER } from "../../../domain/settings/types";
import {
  addOrgAdmin,
  loadOrganisation,
  offboard,
  removeOrgAdmin,
  setSso,
  startOrganisation,
} from "../../../application/settings/organisation";
import { useT } from "../../hooks/useT";
import { buttonClass, ERROR_MESSAGE, FIELD, HINT_IN_ROW, OK_MESSAGE, PILL, SELECT } from "./blocks";
import { Field } from "./Field";
import { StatusLine } from "./StatusLine";

const ROLE_KEY = { admin: "set.sharedAdmin", member: "set.sharedMember", reader: "set.sharedReader" } as const;
const LIST = "grid min-w-0 grid-cols-1 rounded-lg border border-s-border";
const ROW = "grid gap-1 border-b border-s-border px-3 py-2 last:border-b-0";
const LINE = "flex flex-wrap items-center gap-x-3 gap-y-1";

/** Settings › Machines › Organisation of a machine's server (docs/workspaces.md, Organisation): closed until asked, as
 *  opening it publishes this Mac's organisation keys there. For an organisation admin: the admins, devices to add (after
 *  comparing their code), every workspace with whether the organisation manages it, and every person with Offboard. */
export function MachineOrganisation({ machine }: { machine: Machine }) {
  const { t, tn } = useT();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<{ status: OrgStatus; overview: OrgOverview | null } | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  // the device whose code is being compared, the person whose offboarding is being confirmed
  const [adding, setAdding] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<OrgPerson | null>(null);

  const step = async (work: () => Promise<unknown>, done?: (r: unknown) => string | { text: string; ok: boolean }) => {
    setBusy(true);
    setMessage(null);
    // no `finally`: the React Compiler does not lower it
    const shown = await work()
      .then(async r => {
        setState(await loadOrganisation(machine.id));
        const d = done?.(r);
        return typeof d === "string" ? { text: d, ok: true } : (d ?? null);
      })
      .catch((error: unknown) => ({ text: String(error), ok: false }));
    setMessage(shown);
    setBusy(false);
  };
  if (!open)
    return (
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-medium text-s-fg">{t("set.org")}</span>
        <button
          className={buttonClass("ghost")}
          onClick={() => {
            setOpen(true);
            void step(async () => undefined);
          }}
        >
          {t("set.orgShow")}
        </button>
      </div>
    );
  const status = state?.status;
  const overview = state?.overview;
  const admins = new Set(status?.admins ?? []);
  const nameOf = (fp: string) => overview?.admins.find(a => a.fp === fp)?.name || fp.slice(0, 8);
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-medium text-s-fg">{t("set.org")}</span>
        {status?.me ? <span className={PILL}>{t("set.orgAdmin")}</span> : null}
        <span className="flex-1"></span>
        {busy ? <span className="text-xs text-s-muted">{t("set.sharedAsking")}</span> : null}
        <button className={buttonClass("ghost")} onClick={() => setOpen(false)}>
          {t("set.orgHide")}
        </button>
      </div>
      {message ? <span className={message.ok ? OK_MESSAGE : ERROR_MESSAGE}>{message.text}</span> : null}
      {!status ? null : !status.exists ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className={`${HINT_IN_ROW} flex-1`}>{t(status.owner ? "set.orgNoneOwner" : "set.orgNone")}</p>
          {status.owner ? (
            <button
              className={buttonClass("primary")}
              disabled={busy}
              onClick={() => step(() => startOrganisation(machine.id))}
            >
              {t("set.orgStart")}
            </button>
          ) : null}
        </div>
      ) : !status.me ? (
        <p className={HINT_IN_ROW}>{t("set.orgNotAdmin", { code: status.code })}</p>
      ) : (
        <>
          {/* the plan's risk, said where the role is given: organisation admins can read every workspace they manage */}
          <StatusLine level="warn">{t("set.orgReads")}</StatusLine>
          <span className={HINT_IN_ROW}>{t("set.orgYourCode", { code: status.code })}</span>

          <span className="text-xs font-medium text-s-fg">{t("set.orgAdmins")}</span>
          <div className={LIST}>
            {status.admins.map(fp => (
              <div key={fp} className={ROW}>
                <div className={LINE}>
                  <span className="text-xs text-s-fg">{nameOf(fp)}</span>
                  <span className={`${PILL} font-mono`}>{fp.slice(0, 16)}</span>
                  <span className="flex-1"></span>
                  {status.admins.length > 1 ? (
                    <button
                      className={buttonClass("danger")}
                      disabled={busy}
                      onClick={() => step(() => removeOrgAdmin(machine.id, fp))}
                    >
                      {t("set.orgRemoveAdmin")}
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
            {overview?.candidates.map(c => (
              <div key={c.fp} className={ROW}>
                <div className={LINE}>
                  <span className="text-xs text-s-fg">{c.name}</span>
                  <span className={`${PILL} font-mono`}>{c.code ?? t("set.orgCodeBad")}</span>
                  <span className="flex-1"></span>
                  {c.code && adding !== c.fp ? (
                    <button className={buttonClass()} disabled={busy} onClick={() => setAdding(c.fp)}>
                      {t("set.orgAddAdmin")}
                    </button>
                  ) : null}
                </div>
                {adding === c.fp && c.code ? (
                  <div className={LINE}>
                    <span className={`${HINT_IN_ROW} flex-1`}>
                      {t("set.orgAddSure", { name: c.name, code: c.code })}
                    </span>
                    <button
                      className={buttonClass("primary")}
                      disabled={busy}
                      onClick={() => {
                        setAdding(null);
                        void step(() => addOrgAdmin(machine.id, c.fp, c.code!));
                      }}
                    >
                      {t("set.orgCodesMatch")}
                    </button>
                    <button className={buttonClass("ghost")} onClick={() => setAdding(null)}>
                      {t("mc.cancel")}
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <span className={HINT_IN_ROW}>{t("set.orgAddHelp")}</span>

          <OrgSso
            key={JSON.stringify(status.sso ?? null)}
            sso={status.sso ?? null}
            busy={busy}
            save={sso =>
              step(
                () => setSso(machine.id, sso),
                () => t(sso ? "set.ssoSaved" : "set.ssoTurnedOff"),
              )
            }
          />

          <span className="text-xs font-medium text-s-fg">{t("set.orgWorkspaces")}</span>
          <div className={LIST}>
            {overview?.workspaces.length ? (
              overview.workspaces.map(w => (
                <div key={w.id} className={ROW}>
                  <div className={LINE}>
                    <span className="text-xs text-s-fg">{w.name}</span>
                    <StatusLine level={w.managed ? "ok" : "warn"}>
                      {t(w.managed ? "set.orgManaged" : "set.orgUnmanaged")}
                    </StatusLine>
                    <span className="text-xs text-s-muted">{tn("set.orgDevices", w.members.length)}</span>
                  </div>
                  {!w.managed ? <span className={HINT_IN_ROW}>{t("set.orgUnmanagedHelp")}</span> : null}
                </div>
              ))
            ) : (
              <p className={`${ROW} ${HINT_IN_ROW}`}>{t("set.orgNoWorkspaces")}</p>
            )}
          </div>

          <span className="text-xs font-medium text-s-fg">{t("set.orgPeople")}</span>
          <div className={LIST}>
            {overview?.people.map(p => {
              const key = p.devices.map(d => d.fp).join(",");
              // an organisation admin leaves the organisation first, then it can be offboarded like anyone
              const isAdmin = p.devices.some(d => admins.has(d.fp));
              const mine = overview.workspaces.filter(w => p.workspaces.some(x => x.id === w.id));
              const removable = mine.filter(w => w.admin).map(w => w.name);
              const skipped = mine.filter(w => !w.admin).map(w => w.name);
              return (
                <div key={key} className={ROW}>
                  <div className={LINE}>
                    <span className="text-xs text-s-fg">{p.name}</span>
                    {p.email ? <span className="text-xs text-s-muted">{p.email}</span> : null}
                    {/* a device under no person is its own row: its name once */}
                    {p.devices.length > 1 || p.devices[0]?.name !== p.name ? (
                      <span className="text-xs text-s-muted">{p.devices.map(d => d.name).join(", ")}</span>
                    ) : null}
                    <span className="flex-1"></span>
                    {!isAdmin && leaving !== p ? (
                      <button className={buttonClass("danger")} disabled={busy} onClick={() => setLeaving(p)}>
                        {t("set.orgOffboard")}
                      </button>
                    ) : null}
                  </div>
                  {p.unverified ? <StatusLine level="warn">{t("set.orgEmailUnverified")}</StatusLine> : null}
                  <span className={HINT_IN_ROW}>
                    {p.workspaces.map(w => `${w.name} (${w.role ? t(ROLE_KEY[w.role]) : "?"})`).join(" · ")}
                  </span>
                  {leaving === p ? (
                    <div className="grid gap-1.5 rounded-md bg-fill px-2.5 py-2">
                      <span className="text-xs text-s-fg">
                        {t("set.orgOffboardSure", {
                          name: p.name,
                          workspaces: removable.join(", ") || t("set.orgNoneOfThem"),
                          devices: p.devices.length,
                        })}
                      </span>
                      {skipped.length ? (
                        <StatusLine level="warn">
                          {t("set.orgOffboardSkipped", { workspaces: skipped.join(", ") })}
                        </StatusLine>
                      ) : null}
                      <div className={LINE}>
                        <button
                          className={buttonClass("dangerSolid")}
                          disabled={busy}
                          onClick={() => {
                            setLeaving(null);
                            void step(
                              () =>
                                offboard(
                                  machine.id,
                                  p.devices.map(d => d.fp),
                                ),
                              r => {
                                const o = r as Awaited<ReturnType<typeof offboard>>;
                                const text = [
                                  t("set.orgOffboarded", { name: p.name, n: o.removed.length, revoked: o.revoked }),
                                  ...o.failed.map(f => `${f.name}: ${f.error}`),
                                  o.skipped.length
                                    ? t("set.orgOffboardSkipped", { workspaces: o.skipped.join(", ") })
                                    : "",
                                  o.unrevoked ? t("set.orgOffboardNotRevoked", { error: o.unrevoked }) : "",
                                ]
                                  .filter(Boolean)
                                  .join(" ");
                                // the devices can still connect: not a success
                                return { text, ok: !o.unrevoked };
                              },
                            );
                          }}
                        >
                          {t("set.orgOffboardConfirm")}
                        </button>
                        <button className={buttonClass("ghost")} onClick={() => setLeaving(null)}>
                          {t("mc.cancel")}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/** SSO for joining a workspace on this server (docs/workspaces.md, SSO): the provider (Google, Microsoft Entra ID or
 *  another OpenID Connect issuer), its client id, the email domains allowed (Entra: its tenant instead) and whether
 *  signing in is required. Saved as an entry this Mac signs on the organisation list, so the server can never turn it
 *  on, off or wider itself. */
function OrgSso({ sso, busy, save }: { sso: Sso | null; busy: boolean; save: (sso: Sso | null) => void }) {
  const { t } = useT();
  const [draft, setDraft] = useState(() => ({
    provider: !sso || sso.issuer === GOOGLE_ISSUER ? "google" : entraTenant(sso.issuer) ? "entra" : "other",
    tenant: (sso && entraTenant(sso.issuer)) ?? "",
    issuer: sso && sso.issuer !== GOOGLE_ISSUER && !entraTenant(sso.issuer) ? sso.issuer : "",
    client: sso?.client ?? "",
    domains: sso?.domains.join(", ") ?? "",
    required: sso?.required ?? true,
  }));
  const entra = draft.provider === "entra";
  const issuer =
    draft.provider === "google"
      ? GOOGLE_ISSUER
      : entra
        ? entraIssuer(draft.tenant.trim().toLowerCase())
        : draft.issuer.trim();
  const edit = (patch: Partial<typeof draft>) => setDraft(d => ({ ...d, ...patch }));
  const domains = draft.domains
    .split(/[\s,]+/)
    .map(d => d.trim())
    .filter(Boolean);
  const ready =
    !!draft.client.trim() && (entra ? !!entraTenant(issuer) : domains.length > 0 && issuer.startsWith("https://"));
  return (
    <div className="grid gap-2">
      <div className={LINE}>
        <span className="text-xs font-medium text-s-fg">{t("set.ssoTitle")}</span>
        <StatusLine level={sso ? "ok" : "warn"}>
          {sso ? t(sso.required ? "set.ssoOnRequired" : "set.ssoOnOptional") : t("set.ssoOff")}
        </StatusLine>
      </div>
      <div className={`${LIST} gap-2 p-3`}>
        <Field label={t("set.ssoProvider")} id="sso-provider">
          <select
            id="sso-provider"
            className={SELECT}
            value={draft.provider}
            onChange={e => edit({ provider: e.target.value })}
          >
            <option value="google">Google</option>
            <option value="entra">{t("set.ssoEntra")}</option>
            <option value="other">{t("set.ssoOther")}</option>
          </select>
        </Field>
        {entra ? (
          <Field label={t("set.ssoTenant")} hint={t("set.ssoTenantHelp")} id="sso-tenant">
            <input
              id="sso-tenant"
              className={`${FIELD} font-mono`}
              placeholder="00000000-0000-0000-0000-000000000000"
              spellCheck={false}
              value={draft.tenant}
              onChange={e => edit({ tenant: e.target.value })}
            />
          </Field>
        ) : null}
        {draft.provider === "other" ? (
          <Field label={t("set.ssoIssuer")} hint={t("set.ssoIssuerHelp")} id="sso-issuer">
            <input
              id="sso-issuer"
              className={`${FIELD} font-mono`}
              placeholder="https://"
              spellCheck={false}
              value={draft.issuer}
              onChange={e => edit({ issuer: e.target.value })}
            />
          </Field>
        ) : null}
        <Field
          label={t("set.ssoClient")}
          hint={t(entra ? "set.ssoClientHelpEntra" : "set.ssoClientHelp")}
          id="sso-client"
        >
          <input
            id="sso-client"
            className={`${FIELD} font-mono`}
            spellCheck={false}
            value={draft.client}
            onChange={e => edit({ client: e.target.value })}
          />
        </Field>
        {entra ? null : (
          <Field label={t("set.ssoDomains")} hint={t("set.ssoDomainsHelp")} id="sso-domains">
            <input
              id="sso-domains"
              className={FIELD}
              placeholder="example.com"
              spellCheck={false}
              value={draft.domains}
              onChange={e => edit({ domains: e.target.value })}
            />
          </Field>
        )}
        <Field label={t("set.ssoRequired")} hint={t("set.ssoRequiredHelp")} id="sso-required">
          <input
            id="sso-required"
            type="checkbox"
            checked={draft.required}
            onChange={e => edit({ required: e.target.checked })}
          />
        </Field>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {sso ? (
            <button className={buttonClass("ghost")} disabled={busy} onClick={() => save(null)}>
              {t("set.ssoTurnOff")}
            </button>
          ) : null}
          <button
            className={buttonClass("primary")}
            disabled={busy || !ready}
            onClick={() =>
              save({ issuer, client: draft.client.trim(), domains: entra ? [] : domains, required: draft.required })
            }
          >
            {t(sso ? "set.ssoSave" : "set.ssoTurnOn")}
          </button>
        </div>
      </div>
      <span className={HINT_IN_ROW}>{t("set.ssoHelp")}</span>
    </div>
  );
}
