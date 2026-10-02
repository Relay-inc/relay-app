import { useEffect, useRef, useState } from "react";
import type { Key } from "../../../shared/i18n";
import { numberFormat } from "../../../shared/format";
import type { MailAcct, MailNew } from "../../../domain/settings/types";
import { useSettingsStore } from "../../../application/settings/store";
import {
  addMailAccount,
  connectMail,
  dropMailAccount,
  saveMail,
  setMailAccount,
  setMailDraft,
  testMail,
} from "../../../application/settings/integrations";
import { Html } from "../../components/Html";
import { Select } from "../../components/Select";
import { useT } from "../../hooks/useT";
import {
  buttonClass,
  CODE,
  ERROR_MESSAGE,
  FIELD,
  FOOTER_IN_ROW,
  HINT,
  HINT_IN_ROW,
  OK_MESSAGE,
  SELECT,
  withoutColon,
} from "./blocks";
import { Field } from "./Field";
import { Footer } from "./Footer";
import { Segmented } from "./Segmented";

// a step of the account guide: a small grid of its own
const STEP = "grid justify-items-start gap-2";
const PARA = `text-sm leading-normal ${CODE}`;
const HINT_STEP = `mt-0.5 text-sm leading-normal text-s-faint ${CODE}`;
const SUB = "mt-2 grid gap-0.5 border-t border-s-border pt-3";

// the backend's errors we know what to do about, each with the text that says it
const KNOWN_ERRORS: [RegExp, Key][] = [
  [/^Login failed/, "mail.errLogin"],
  [/No password in the keychain/, "mail.errNoPw"],
  [/not approved in time/, "mail.errKeychain"],
  [/Only Gmail/, "mail.errGmail"],
  [/IMAP (connection|timeout|protocol)|did not answer in time/, "mail.errNet"],
];

/** Mail's body on its page in Integrations: the accounts, and the steps to connect another. No password of our own
 *  either, the app reads the app password from the macOS keychain. The accounts as edited are saved with Save; what
 *  sits in the add fields stays in the store until it is used. */
export function MailSettings({ onRemove }: { onRemove: () => void }) {
  const { t, th, locale } = useT();
  const config = useSettingsStore(s => s.integrations.mail.edit);
  const draft = useSettingsStore(s => s.integrations.mail.draft);
  const tests = useSettingsStore(s => s.integrations.mail.tests);
  // the advanced section opens when a keychain service is filled in (or already was); otherwise it is the user's
  const advanced = useRef<HTMLDetailsElement>(null);
  const serviceFilled = !!draft.keychain_service;
  useEffect(() => {
    if (serviceFilled && advanced.current) advanced.current.open = true;
  }, [serviceFilled]);
  const busy = useSettingsStore(s => s.integrations.mail.busy);
  // which connect steps show
  const [kind, setKind] = useState<"gmail" | "imap">("gmail");
  const message = useSettingsStore(s => s.integrations.mail.message);

  // a backend error as what to do about it, with the raw message small below for when it is something else
  const explainError = (error: string) => {
    const known = KNOWN_ERRORS.find(([pattern]) => pattern.test(error));
    if (!known) return error;
    return (
      <>
        {t(known[1])}
        <div className={HINT}>{error}</div>
      </>
    );
  };
  const testResult = (account: MailAcct) => {
    const result = tests[account.email];
    if (result === "busy") return <span className="spinner"></span>;
    if (!result) return null;
    if (!result.ok) return <span className={ERROR_MESSAGE}>{explainError(result.text)}</span>;
    const mailCount = numberFormat(locale, {}).format(Number((result.text.match(/\d+/) || ["0"])[0]));
    return <span className={OK_MESSAGE}>{t("mail.testOk", { n: mailCount })}</span>;
  };
  const busyText = (step: string) =>
    busy === step ? (
      <>
        <span className="spinner"></span> {t("mail.connecting")}
      </>
    ) : null;
  const textField = (id: string, label: string, key: keyof MailNew, placeholder: string) => (
    <Field label={withoutColon(label)} id={id} className="w-full">
      <input
        className={FIELD}
        id={id}
        value={draft[key]}
        onChange={e => setMailDraft(key, e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
      />
    </Field>
  );
  const emailField = (id: string) => (
    <Field label={withoutColon(t("mail.emailL"))} id={id} className="w-full">
      <input
        className={FIELD}
        id={id}
        type="email"
        value={draft.email}
        onChange={e => setMailDraft("email", e.target.value)}
        placeholder="naam@bedrijf.be"
        spellCheck={false}
        autoComplete="off"
      />
    </Field>
  );

  const passwordField = (label: Key, placeholder?: Key) => (
    <Field label={withoutColon(t(label))} id="mailpw" className="w-full">
      <input
        className={FIELD}
        id="mailpw"
        type="password"
        value={draft.password}
        onChange={e => setMailDraft("password", e.target.value)}
        placeholder={placeholder ? t(placeholder) : ""}
        autoComplete="off"
        spellCheck={false}
      />
    </Field>
  );
  const connectButton = (imap: boolean) => (
    <div className="flex items-center gap-2">
      <button className={buttonClass("primary")} onClick={() => connectMail(imap)} disabled={!!busy}>
        {t("mail.connect")}
      </button>
      {busyText("connect")}
    </div>
  );

  const { accounts } = config;
  const imap = kind === "imap";
  const kinds = [
    ["gmail", t("mail.kindGmail")],
    ["imap", t("mail.kindImap")],
  ] as const;
  const emails = accounts.map(account => account.email);
  return (
    <div>
      <p className={HINT_IN_ROW}>{t("mail.help")}</p>
      {accounts.length > 0 && (
        <>
          <div className={SUB}>
            <b className="text-xs font-semibold">{t("mail.accountsH")}</b>
          </div>
          <div className="rounded-md border border-s-border px-3">
            {accounts.map(account => (
              <div
                key={account.email}
                className="group flex items-center gap-3 border-t border-s-border py-2.5 first:border-t-0"
              >
                <span className="min-w-0 flex-1">
                  <b className="block truncate font-medium">{account.email}</b>
                  <span className="block truncate text-xs text-s-muted">
                    {t("mail.inKeychain", { svc: account.keychain_service })}
                    {account.host ? ` · ${account.host}` : ""}
                  </span>
                </span>
                {testResult(account)}
                <span className="flex items-center gap-1 opacity-0 transition-opacity duration-150 ease-in-out group-focus-within:opacity-100 group-hover:opacity-100">
                  <button className={buttonClass()} onClick={() => testMail(account)}>
                    {t("mail.test")}
                  </button>
                  <button className={buttonClass("ghost")} onClick={() => dropMailAccount(account)}>
                    {t("mail.remove")}
                  </button>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
      {/* which account the app reads, when there are several */}
      {accounts.length >= 2 && (
        <Field label={withoutColon(t("mail.account"))} id="mailacct">
          <Select
            className={SELECT}
            id="mailacct"
            options={emails.map(email => ({ id: email, name: email }))}
            value={config.account || emails[0]}
            onChange={setMailAccount}
          />
        </Field>
      )}
      <div className={FOOTER_IN_ROW}>
        <button className={buttonClass("ghost")} onClick={onRemove}>
          {t("ag.remove")}
        </button>
        <Footer message={message} explain={explainError}>
          <button className={buttonClass("primary")} onClick={saveMail}>
            {t("set.save")}
          </button>
        </Footer>
      </div>
      <div className={SUB}>
        <b className="text-xs font-semibold">
          {accounts.length ? t("mail.guideMore") : imap ? t("mail.guideImap") : t("mail.guideH")}
        </b>
      </div>
      <Segmented className="w-fit" options={kinds} value={kind} onPick={setKind} />
      {imap ? (
        <div className={STEP}>
          {emailField("mailnew")}
          {textField("mailhost", t("mail.hostL"), "host", "mail.example.com")}
          {textField("mailport", t("mail.portL"), "port", "993")}
          {passwordField("mail.imapPwL")}
          {connectButton(true)}
          <Html as="p" className={HINT_STEP} html={th("mail.imapHint")} />
        </div>
      ) : (
        <>
          <div className={STEP}>
            <b className="font-medium">{t("mail.step1H")}</b>
            <Html as="p" className={PARA} html={th("mail.step1")} />
            <a className={buttonClass()} href="https://myaccount.google.com/apppasswords" target="_blank">
              {t("mail.step1Btn")}
            </a>
            <Html as="p" className={HINT_STEP} html={th("mail.step1Hint")} />
          </div>
          <div className={STEP}>
            <b className="font-medium">{t("mail.step2H")}</b>
            {emailField("mailnew")}
            {passwordField("mail.pwL", "mail.pwPh")}
            {connectButton(false)}
            <Html as="p" className={HINT_STEP} html={th("mail.step2Hint")} />
          </div>
        </>
      )}
      {/* the same without the app password: an account whose password already sits in the keychain */}
      <details ref={advanced} className={STEP}>
        <summary className="font-medium">{t("mail.advH")}</summary>
        <Html as="p" className={HINT_STEP} html={th("mail.adv")} />
        {emailField("mailemail2")}
        {textField("mailhost2", t("mail.advHostL"), "host", "mail.example.com")}
        {textField("mailport2", t("mail.portL"), "port", "993")}
        {textField("mailsvc", t("mail.svcL"), "keychain_service", "himalaya-weareantenna-imap")}
        {textField("mailkacc", t("mail.kaccL"), "keychain_account", "weareantenna")}
        <div className="flex items-center gap-2">
          <button className={buttonClass()} onClick={addMailAccount} disabled={!!busy}>
            {t("mail.addTest")}
          </button>
          {busyText("advanced")}
        </div>
      </details>
    </div>
  );
}
