import { useState } from "react";
import type { Message } from "../../../domain/settings/types";
import { useSettingsStore } from "../../../application/settings/store";
import { saveBuddy } from "../../../application/settings/buddy";
import { Html } from "../../components/Html";
import { Select } from "../../components/Select";
import { useT } from "../../hooks/useT";
import { buttonClass, FIELD, FOOTER_IN_ROW, HINT_IN_ROW, SELECT, withoutColon } from "./blocks";
import { Field } from "./Field";
import { Footer } from "./Footer";
import { Section } from "./Section";

// the regions' APIs, as packages/integration-buddy allows them
const HOSTS = [
  { id: "api.buddy.works", name: "US (app.buddy.works)" },
  { id: "api.eu.buddy.works", name: "EU (eu.buddy.works)" },
  { id: "api.asia.buddy.works", name: "Asia (asia.buddy.works)" },
];

/** Buddy's page in Integrations: the region and a read-only token. Which Buddy project a vault project shows is in
 *  Settings › Projects. */
export function BuddySettings() {
  const { t, th } = useT();
  const saved = useSettingsStore(s => String(s.settings.integrations.buddy?.host ?? HOSTS[0].id));
  const hasToken = useSettingsStore(s => !!s.integrations.tokens.buddy);
  const [host, setHost] = useState(saved);
  const [token, setToken] = useState("");
  const [message, setMessage] = useState<Message | null>(null);
  const onSave = async () => {
    setMessage(await saveBuddy(host, token));
    setToken("");
  };
  return (
    <Section title={t("int.connection")}>
      <div>
        <Html as="p" className={HINT_IN_ROW} html={th("bd.help")} />
        <Field label={withoutColon(t("bd.region"))}>
          <Select className={SELECT} aria-label={t("bd.region")} options={HOSTS} value={host} onChange={setHost} />
        </Field>
        <Field label="Token" id="buddy-token">
          <input
            className={FIELD}
            id="buddy-token"
            type="password"
            autoComplete="off"
            placeholder={hasToken ? t("int.tokenStored") : t("int.tokenPaste")}
            value={token}
            onChange={e => setToken(e.target.value)}
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
