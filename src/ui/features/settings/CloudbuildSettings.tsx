import { useState } from "react";
import type { Message } from "../../../domain/settings/types";
import { testCloudbuild } from "../../../application/settings/cloudbuild";
import { Html } from "../../components/Html";
import { useT } from "../../hooks/useT";
import { buttonClass, FOOTER_IN_ROW, HINT_IN_ROW } from "./blocks";
import { Footer } from "./Footer";
import { Section } from "./Section";

/** Cloud Build's page in Integrations: no token of our own, the app uses gcloud's login. Check lists the projects it
 *  can see. Which GCP project a vault project shows is in Settings › Projects. */
export function CloudbuildSettings() {
  const { t, th } = useT();
  const [message, setMessage] = useState<Message | null>(null);
  return (
    <Section title={t("int.connection")}>
      <Html as="p" className={HINT_IN_ROW} html={th("cb.help")} />
      <div className={FOOTER_IN_ROW}>
        <Footer message={message}>
          <button className={buttonClass("primary")} onClick={async () => setMessage(await testCloudbuild())}>
            {t("cb.check")}
          </button>
        </Footer>
      </div>
    </Section>
  );
}
