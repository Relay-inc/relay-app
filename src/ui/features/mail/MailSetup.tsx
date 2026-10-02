import { useT } from "../../hooks/useT";

/** No account yet: what to do in three steps, and the way into the settings. The texts are the app's own. */
export function MailSetup({ onSetup }: { onSetup: () => void }) {
  const { t } = useT();
  return (
    <div className="max-w-lg my-8 mx-auto px-6 py-6 border border-separator rounded-xl bg-fill">
      <h2 className="text-base font-semibold mb-1.5">{t("mail.setupTitle")}</h2>
      <p className="mb-3 text-sm leading-normal">{t("mail.setupIntro")}</p>
      <ol className="mb-3.5 pl-5 text-sm leading-relaxed list-decimal [&_li]:mb-1.5 [&_code]:font-mono [&_code]:text-xs [&_code]:bg-fill [&_code]:px-1 [&_code]:py-px [&_code]:rounded-sm">
        <li>{t("mail.setupStep1")}</li>
        <li>{t("mail.setupStep2")}</li>
        <li>{t("mail.setupStep3")}</li>
      </ol>
      <p className="mb-3 text-secondary text-sm">{t("mail.setupPw")}</p>
      <button className="btn btn-primary" onClick={onSetup}>
        {t("mail.setupOpen")}
      </button>
    </div>
  );
}
