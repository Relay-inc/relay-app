import { useState } from "react";
import type { VaultSync } from "../../../domain/settings/types";
import { agoParts } from "../../../domain/settings/machines";
import { useSettingsStore } from "../../../application/settings/store";
import { saveVaultSync } from "../../../application/settings/vault-sync";
import { relativeFormat } from "../../../shared/format";
import { Html } from "../../components/Html";
import { Select } from "../../components/Select";
import { useT } from "../../hooks/useT";
import { buttonClass, FIELD, SELECT } from "./blocks";
import { Field } from "./Field";
import { Footer } from "./Footer";
import { Section } from "./Section";
import { StatusLine } from "./StatusLine";
import { Switch } from "./Switch";

const MINUTES = [5, 15, 30, 60];
const NONE: VaultSync = { remote: "", on: false, minutes: 15, last: null };

/** The vault's git backup: the remote, how often, on or off, kept as typed until Save, and the last round. */
export function VaultSyncSection() {
  const { t, th, locale } = useT();
  const saved = useSettingsStore(s => s.vaultSync.saved) ?? NONE;
  const message = useSettingsStore(s => s.vaultSync.message);
  // what is typed, back to what the backend says whenever the saved setting changes
  const [form, setForm] = useState(saved);
  const [formOf, setFormOf] = useState(saved);
  if (formOf.remote !== saved.remote || formOf.on !== saved.on || formOf.minutes !== saved.minutes) {
    setFormOf(saved);
    setForm(saved);
  }
  const last = saved.last;
  const ago = last ? agoParts(last.at) : null;
  const when = ago ? relativeFormat(locale, { numeric: "auto" }).format(ago.value, ago.unit) : "";
  const every = MINUTES.map(minutes => ({ id: String(minutes), name: t("vs.minutes", { n: minutes }) }));
  return (
    <Section
      title={t("vs.title")}
      desc={<Html html={th("vs.help")} />}
      rows
      footer={
        <Footer message={message}>
          <button className={buttonClass("primary")} onClick={() => saveVaultSync(form.remote, form.on, form.minutes)}>
            {t("set.save")}
          </button>
        </Footer>
      }
    >
      <Field label={t("vs.remote")} id="vsremote" hint={t("vs.remoteHelp")}>
        <input
          className={`${FIELD} font-mono`}
          id="vsremote"
          value={form.remote}
          onChange={e => setForm({ ...form, remote: e.target.value })}
          spellCheck={false}
          placeholder="git@github.com:you/vault.git"
        />
      </Field>
      <Field label={t("vs.every")} id="vsevery">
        <Select
          className={SELECT}
          id="vsevery"
          options={every}
          value={String(form.minutes)}
          onChange={value => setForm({ ...form, minutes: Number(value) })}
        />
      </Field>
      <Field label={t("vs.on")} id="vson">
        <Switch id="vson" on={form.on} onToggle={on => setForm({ ...form, on })} />
      </Field>
      {saved.remote && (
        <div>
          {!last ? (
            <StatusLine level="off">{t("vs.never")}</StatusLine>
          ) : last.ok ? (
            <StatusLine level="ok">
              {last.commit ? t("vs.pushed", { when, commit: last.commit }) : t("vs.unchanged", { when })}
            </StatusLine>
          ) : (
            <StatusLine level="warn">{t("vs.failed", { when, error: last.error })}</StatusLine>
          )}
        </div>
      )}
    </Section>
  );
}
