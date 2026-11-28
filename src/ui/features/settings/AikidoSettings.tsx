import { useState } from "react";
import type { Message } from "../../../domain/settings/types";
import { useSettingsStore } from "../../../application/settings/store";
import { saveAikido } from "../../../application/settings/aikido";
import { Html } from "../../components/Html";
import { Select } from "../../components/Select";
import { useT } from "../../hooks/useT";
import { buttonClass, FIELD, FOOTER_IN_ROW, HINT_IN_ROW, SELECT, withoutColon } from "./blocks";
import { Field } from "./Field";
import { Footer } from "./Footer";
import { Section } from "./Section";

// the regions, as packages/integration-aikido allows them
const REGIONS = [
  { id: "eu", name: "EU (app.aikido.dev)" },
  { id: "us", name: "US (app.us.aikido.dev)" },
  { id: "au", name: "AU (app.au.aikido.dev)" },
  { id: "me", name: "ME (app.me.aikido.dev)" },
];

/** Aikido's page in Integrations: the region and a read-only API client. Which code repos a vault project shows is in
 *  Settings › Projects. The client ID and secret are typed, saved to the keychain and never shown again. */
export function AikidoSettings() {
  const { t, th } = useT();
  const saved = useSettingsStore(s => String(s.settings.integrations.aikido?.region ?? REGIONS[0].id));
  const hasToken = useSettingsStore(s => !!s.integrations.tokens.aikido);
  const [region, setRegion] = useState(saved);
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [message, setMessage] = useState<Message | null>(null);
  const onSave = async () => {
    setMessage(await saveAikido(region, clientId, secret));
    setClientId("");
    setSecret("");
  };
  return (
    <Section title={t("int.connection")}>
      <div>
        <Html as="p" className={HINT_IN_ROW} html={th("ak.help")} />
        <Field label={withoutColon(t("ak.region"))}>
          <Select
            className={SELECT}
            aria-label={t("ak.region")}
            options={REGIONS}
            value={region}
            onChange={setRegion}
          />
        </Field>
        <Field label={t("ak.clientId")} id="aikido-client-id">
          <input
            className={FIELD}
            id="aikido-client-id"
            type="password"
            autoComplete="off"
            placeholder={hasToken ? t("int.tokenStored") : t("ak.idPaste")}
            value={clientId}
            onChange={e => setClientId(e.target.value)}
            spellCheck={false}
          />
        </Field>
        <Field label={t("ak.secret")} id="aikido-secret">
          <input
            className={FIELD}
            id="aikido-secret"
            type="password"
            autoComplete="off"
            placeholder={hasToken ? t("int.tokenStored") : t("ak.secretPaste")}
            value={secret}
            onChange={e => setSecret(e.target.value)}
            spellCheck={false}
          />
        </Field>
        <div className={FOOTER_IN_ROW}>
          <Footer message={message}>
            <button className={buttonClass("primary")} onClick={onSave}>
              {t("set.save")}
            </button>
          </Footer>
        </div>
      </div>
    </Section>
  );
}
