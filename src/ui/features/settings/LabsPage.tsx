import { filesOn } from "../../../domain/settings/types";
import { useSettingsStore } from "../../../application/settings/store";
import { saveFiles } from "../../../application/settings/general-page";
import { saveMailExperimental } from "../../../application/settings/integrations";
import { useT } from "../../hooks/useT";
import { HINT, PILL } from "./blocks";
import { Section } from "./Section";
import { Switch } from "./Switch";

/** Labs: the features still being tried, each with a switch and chips naming what it changes. */
export function LabsPage() {
  const { t } = useT();
  const files = useSettingsStore(s => filesOn(s.settings));
  const mail = useSettingsStore(s => !!s.settings.mail?.experimental);
  const chips = (names: string[]) => (
    <div className="flex flex-wrap gap-1.5">
      {names.map(name => (
        <span key={name} className={PILL}>
          {name}
        </span>
      ))}
    </div>
  );
  return (
    <>
      <p className={`${HINT} -mt-4`}>{t("set.experimentalHelp")}</p>
      <Section
        title={t("set.files")}
        desc={t("set.filesHelp")}
        action={<Switch id="files" on={files} label={t("set.files")} onToggle={saveFiles} />}
      >
        {chips([t("labs.files.sidebar"), t("labs.files.keys")])}
      </Section>
      <Section
        title={t("labs.mail")}
        desc={t("labs.mailHelp")}
        info={t("mail.experimentalHint")}
        action={<Switch id="mailexp" on={mail} label={t("labs.mail")} onToggle={saveMailExperimental} />}
      >
        {chips([t("nav.mail"), t("nav.today"), t("labs.mail.keys")])}
      </Section>
    </>
  );
}
