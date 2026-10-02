import { useState, type ReactNode } from "react";
import type { Key } from "../../../shared/i18n";
import { numberFormat } from "../../../shared/format";
import type { MailAcct, MailNew } from "../../../domain/settings/types";
import { useSettingsStore } from "../../../application/settings/store";
import {
  addMailAccount,
  clearMailMessage,
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
import { RemoveFooter } from "./RemoveFooter";
import { Section } from "./Section";
import { SettingsMenu } from "./SettingsMenu";

// a step of the account guide: a small grid of its own, the ones after the first below a line
const STEP = "grid justify-items-start gap-2 [&>*]:max-w-full";
const NEXT_STEP = `${STEP} border-t border-s-border pt-3.5`;
const STEP_TITLE = "text-[13px] font-medium text-s-fg";
const PARA = `text-[13px] leading-snug text-s-fg ${CODE}`;

type AddKind = "gmail" | "imap" | "keychain";
const TITLES: Record<AddKind, Key> = { gmail: "mail.guideH", imap: "mail.guideImap", keychain: "mail.kindKeychain" };

// the backend's errors we know what to do about, each with the text that says it
const KNOWN_ERRORS: [RegExp, Key][] = [
  [/^Login failed/, "mail.errLogin"],
  [/No password in the keychain/, "mail.errNoPw"],
  [/not approved in time/, "mail.errKeychain"],
  [/Only Gmail/, "mail.errGmail"],
  [/IMAP (connection|timeout|protocol)|did not answer in time/, "mail.errNet"],
];

/** Mail's sections on its page in Integrations: the accounts with an Add menu, or, while one is being added, the steps
 *  for its kind (Gmail with an app password, another IMAP server, a password already in the keychain). No password of
 *  our own either, the app reads it from the macOS keychain. The accounts as edited are saved with Save; what sits in
 *  the add fields stays in the store until it is used. */
export function MailSettings({ onRemove }: { onRemove: () => void }) {
  const { t, th, locale } = useT();
  const config = useSettingsStore(s => s.integrations.mail.edit);
  const draft = useSettingsStore(s => s.integrations.mail.draft);
  const tests = useSettingsStore(s => s.integrations.mail.tests);
  const busy = useSettingsStore(s => s.integrations.mail.busy);
  const message = useSettingsStore(s => s.integrations.mail.message);
  // the kind of account being added, its steps shown instead of the list; "" for the list
  const [adding, setAdding] = useState<"" | AddKind>("");

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
  // the add steps' button, with the busy spinner or the message of the last try before it; an account added and
  // saved brings the list back, with its message
  const addButton = (step: "connect" | "advanced", label: Key, add: () => Promise<boolean>) => {
    let note: ReactNode = null;
    let good = true;
    if (busy === step)
      note = (
        <>
          <span className="spinner"></span> {t("mail.connecting")}
        </>
      );
    else if (message) {
      note = message.ok ? message.text : explainError(message.text);
      good = message.ok;
    }
    return (
      <div className={`${FOOTER_IN_ROW} justify-self-stretch`}>
        {note && <span className={good ? OK_MESSAGE : ERROR_MESSAGE}>{note}</span>}
        <span className="flex-1"></span>
        <button
          className={buttonClass("primary")}
          disabled={!!busy}
          onClick={async () => {
            if (await add()) setAdding("");
          }}
        >
          {t(label)}
        </button>
      </div>
    );
  };

  if (adding) {
    const steps: Record<AddKind, ReactNode> = {
      gmail: (
        <>
          <div className={STEP}>
            <b className={STEP_TITLE}>{t("mail.step1H")}</b>
            <Html as="p" className={PARA} html={th("mail.step1")} />
            <Html as="p" className={HINT_IN_ROW} html={th("mail.step1Hint")} />
            <a className={buttonClass()} href="https://myaccount.google.com/apppasswords" target="_blank">
              {t("mail.step1Btn")}
            </a>
          </div>
          <div className={NEXT_STEP}>
            <b className={STEP_TITLE}>{t("mail.step2H")}</b>
            {emailField("mailnew")}
            {passwordField("mail.pwL", "mail.pwPh")}
            <Html as="p" className={HINT_IN_ROW} html={th("mail.step2Hint")} />
            {addButton("connect", "mail.connect", () => connectMail(false))}
          </div>
        </>
      ),
      imap: (
        <div className={STEP}>
          {emailField("mailnew")}
          {textField("mailhost", t("mail.hostL"), "host", "mail.example.com")}
          {textField("mailport", t("mail.portL"), "port", "993")}
          {passwordField("mail.imapPwL")}
          <Html as="p" className={HINT_IN_ROW} html={th("mail.imapHint")} />
          {addButton("connect", "mail.connect", () => connectMail(true))}
        </div>
      ),
      // without the app password: an account whose password already sits in the keychain (himalaya's, say)
      keychain: (
        <div className={STEP}>
          {emailField("mailemail2")}
          {textField("mailhost2", t("mail.advHostL"), "host", "mail.example.com")}
          {textField("mailport2", t("mail.portL"), "port", "993")}
          {textField("mailsvc", t("mail.svcL"), "keychain_service", "himalaya-weareantenna-imap")}
          {textField("mailkacc", t("mail.kaccL"), "keychain_account", "weareantenna")}
          {addButton("advanced", "mail.addTest", addMailAccount)}
        </div>
      ),
    };
    return (
      <Section
        title={t(TITLES[adding])}
        desc={adding === "keychain" ? <Html html={th("mail.adv")} /> : undefined}
        action={
          <button className={buttonClass("ghost")} onClick={() => setAdding("")}>
            {t("pop.cancel")}
          </button>
        }
      >
        {steps[adding]}
      </Section>
    );
  }

  const { accounts } = config;
  const emails = accounts.map(account => account.email);
  // the kinds of account to add, like the Add menus of integrations and agents
  const kinds = [
    { id: "gmail", name: t("mail.kindGmail") },
    { id: "imap", name: t("mail.kindImap") },
    { id: "keychain", name: t("mail.kindKeychain") },
  ];
  return (
    <Section
      title={t("mail.accountsH")}
      desc={t("mail.help")}
      action={
        <SettingsMenu
          label={t("mail.add")}
          items={kinds}
          onPick={kind => {
            clearMailMessage();
            setAdding(kind as AddKind);
          }}
        />
      }
    >
      {accounts.length ? (
        <div>
          {accounts.map(account => (
            <div
              key={account.email}
              className="group flex items-center gap-3 border-t border-s-border py-2.5 first:border-t-0 first:pt-0 last:pb-0"
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
      ) : (
        <p className={HINT_IN_ROW}>{t("mail.setupIntro")}</p>
      )}
      {/* which account the app reads, when there are several */}
      {accounts.length >= 2 && (
        <Field
          label={t("mail.account")}
          id="mailacct"
          hint={t("mail.accountHint")}
          className="border-t border-s-border pt-3.5"
        >
          <Select
            className={SELECT}
            id="mailacct"
            options={emails.map(email => ({ id: email, name: email }))}
            value={config.account || emails[0]}
            onChange={setMailAccount}
          />
        </Field>
      )}
      <RemoveFooter onRemove={onRemove} message={message} explain={explainError}>
        <button className={buttonClass("primary")} onClick={saveMail}>
          {t("set.save")}
        </button>
      </RemoveFooter>
    </Section>
  );
}
