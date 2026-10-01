import { html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { emit } from "../../core/dom";
import type { Key } from "../../core/locales/en";
import { currentLocale, t, th } from "../../core/i18n";
import {
  buttonClass,
  CODE,
  ERROR_MESSAGE,
  field,
  FIELD,
  footer,
  FOOTER_IN_ROW,
  HINT,
  HINT_IN_ROW,
  withoutColon,
  OK_MESSAGE,
  SELECT,
  inputValue,
} from "./blocks";
import { SettingsElement } from "./settings-element";
import { tws } from "./styles";
import type { MailAcct, MailCfg, Message } from "./types";

export type MailNew = { email: string; keychain_service: string; keychain_account: string; password: string };

declare global {
  interface HTMLElementTagNameMap {
    "relay-settings-mail": SettingsMail;
  }
  interface HTMLElementEventMap {
    "mail-new": CustomEvent<{ key: keyof MailNew; value: string }>;
    "mail-account": CustomEvent<string>;
    "mail-test": CustomEvent<MailAcct>;
    "mail-drop": CustomEvent<MailAcct>;
    "mail-connect": CustomEvent<void>;
    "mail-add": CustomEvent<void>;
    "mail-save": CustomEvent<void>;
  }
}

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
  [/IMAP (connection|timeout|protocol)/, "mail.errNet"],
];

/** Mail's body in the integrations list: the accounts, and the steps to connect another. No password of our own either,
 *  the app reads the app password from the macOS keychain. Edits stay local until Save. */
@customElement("relay-settings-mail")
export class SettingsMail extends SettingsElement {
  static override styles = [tws];

  @property({ attribute: false }) config!: MailCfg;
  /** What sits in the add fields */
  @property({ attribute: false }) newAccount!: MailNew;
  @property({ attribute: false }) tests: Record<string, Message | "busy"> = {};
  /** "connect" or "advanced" while that step runs */
  @property() busy = "";
  @property() message = "";
  @property({ type: Boolean }) ok = false;

  // a backend error as what to do about it, with the raw message small below for when it is something else
  private explainError(error: string) {
    const known = KNOWN_ERRORS.find(([pattern]) => pattern.test(error));
    if (!known) return error;
    return html`${t(known[1])}
      <div class=${HINT}>${error}</div>`;
  }

  private onNewField = (key: keyof MailNew) => (e: Event) => emit(this, "mail-new", { key, value: inputValue(e) });

  private renderTestResult(account: MailAcct) {
    const result = this.tests[account.email];
    if (result === "busy") return html`<span class="spinner"></span>`;
    if (!result) return nothing;
    if (!result.ok) return html`<span class=${ERROR_MESSAGE}>${this.explainError(result.text)}</span>`;
    const mailCount = Number((result.text.match(/\d+/) || ["0"])[0]).toLocaleString(currentLocale());
    return html`<span class=${OK_MESSAGE}>${t("mail.testOk", { n: mailCount })}</span>`;
  }

  private renderBusy(step: string) {
    return this.busy === step ? html`<span class="spinner"></span> ${t("mail.connecting")}` : nothing;
  }

  private renderAccount(account: MailAcct) {
    return html`<div class="group flex items-center gap-3 border-t border-s-border py-2.5 first:border-t-0">
      <span class="min-w-0 flex-1"
        ><b class="block truncate font-medium">${account.email}</b
        ><span class="block truncate text-xs text-s-muted"
          >${t("mail.inKeychain", { svc: account.keychain_service })}</span
        ></span
      >${this.renderTestResult(account)}
      <span
        class="flex items-center gap-1 opacity-0 transition-opacity duration-150 ease-in-out group-focus-within:opacity-100 group-hover:opacity-100"
        ><button class=${buttonClass()} @click=${() => emit(this, "mail-test", account)}>${t("mail.test")}</button
        ><button class=${buttonClass("ghost")} @click=${() => emit(this, "mail-drop", account)}>
          ${t("mail.remove")}
        </button></span
      >
    </div>`;
  }

  private renderAccounts() {
    if (!this.config.accounts.length) return nothing;
    return html`<div class=${SUB}><b class="text-xs font-semibold">${t("mail.accountsH")}</b></div>
      <div class="rounded-md border border-s-border px-3">
        ${this.config.accounts.map(account => this.renderAccount(account))}
      </div>`;
  }

  // which account the app reads, when there are several
  private renderAccountChoice() {
    const { accounts, account } = this.config;
    if (accounts.length < 2) return nothing;
    const current = account || accounts[0].email;
    const select = html`<select
      class=${SELECT}
      id="mailacct"
      @change=${(e: Event) => emit(this, "mail-account", inputValue(e))}
    >
      ${accounts.map(
        entry => html`<option value=${entry.email} ?selected=${entry.email === current}>${entry.email}</option>`,
      )}
    </select>`;
    return field(withoutColon(t("mail.account")), select, { id: "mailacct" });
  }

  private renderEmailField(id: string) {
    const input = html`<input
      class=${FIELD}
      id=${id}
      type="email"
      .value=${live(this.newAccount.email)}
      @input=${this.onNewField("email")}
      placeholder="naam@bedrijf.be"
      spellcheck="false"
      autocomplete="off"
    />`;
    return field(withoutColon(t("mail.emailL")), input, { id, classes: "w-full" });
  }

  private renderTextField(id: string, label: string, key: keyof MailNew, placeholder: string) {
    const input = html`<input
      class=${FIELD}
      id=${id}
      .value=${live(this.newAccount[key])}
      @input=${this.onNewField(key)}
      placeholder=${placeholder}
      spellcheck="false"
    />`;
    return field(withoutColon(label), input, { id, classes: "w-full" });
  }

  private renderPasswordField() {
    const input = html`<input
      class=${FIELD}
      id="mailpw"
      type="password"
      .value=${live(this.newAccount.password)}
      @input=${this.onNewField("password")}
      placeholder=${t("mail.pwPh")}
      autocomplete="off"
      spellcheck="false"
    />`;
    return field(withoutColon(t("mail.pwL")), input, { id: "mailpw", classes: "w-full" });
  }

  private renderSaveRow() {
    const message = this.message && (this.ok ? this.message : this.explainError(this.message));
    const save = html`<button class=${buttonClass("primary")} @click=${() => emit(this, "mail-save")}>
      ${t("set.save")}
    </button>`;
    return html`<div class=${FOOTER_IN_ROW}>
      <button class=${buttonClass("ghost")} @click=${() => emit(this, "int-remove")}>${t("ag.remove")}</button
      >${footer(message, this.ok, save)}
    </div>`;
  }

  private renderConnectSteps() {
    const heading = this.config.accounts.length ? t("mail.guideMore") : t("mail.guideH");
    return html`<div class=${SUB}><b class="text-xs font-semibold">${heading}</b></div>
      <div class=${STEP}>
        <b class="font-medium">${t("mail.step1H")}</b>
        <p class=${PARA}>${th("mail.step1")}</p>
        <a class=${buttonClass()} href="https://myaccount.google.com/apppasswords" target="_blank"
          >${t("mail.step1Btn")}</a
        >
        <p class=${HINT_STEP}>${th("mail.step1Hint")}</p>
      </div>
      <div class=${STEP}>
        <b class="font-medium">${t("mail.step2H")}</b>
        ${this.renderEmailField("mailnew")} ${this.renderPasswordField()}
        <div class="flex items-center gap-2">
          <button class=${buttonClass("primary")} @click=${() => emit(this, "mail-connect")} ?disabled=${!!this.busy}>
            ${t("mail.connect")}</button
          >${this.renderBusy("connect")}
        </div>
        <p class=${HINT_STEP}>${th("mail.step2Hint")}</p>
      </div>`;
  }

  // the same without the app password: an account whose password already sits in the keychain
  private renderAdvanced() {
    return html`<details class=${STEP} ?open=${!!this.newAccount.keychain_service}>
      <summary class="font-medium">${t("mail.advH")}</summary>
      <p class=${HINT_STEP}>${th("mail.adv")}</p>
      ${this.renderEmailField("mailemail2")}
      ${this.renderTextField("mailsvc", t("mail.svcL"), "keychain_service", "himalaya-weareantenna-imap")}
      ${this.renderTextField("mailkacc", t("mail.kaccL"), "keychain_account", "weareantenna")}
      <div class="flex items-center gap-2">
        <button class=${buttonClass()} @click=${() => emit(this, "mail-add")} ?disabled=${!!this.busy}>
          ${t("mail.addTest")}</button
        >${this.renderBusy("advanced")}
      </div>
    </details>`;
  }

  override render() {
    return html`<p class=${HINT_IN_ROW}>${t("mail.help")}</p>
      ${this.renderAccounts()} ${this.renderAccountChoice()} ${this.renderSaveRow()} ${this.renderConnectSteps()}
      ${this.renderAdvanced()}`;
  }
}
