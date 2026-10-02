import { html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
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
  removeFooter,
  section,
  SELECT,
  inputValue,
} from "./blocks";
import "./settings-menu";
import { SettingsElement } from "./settings-element";
import { contents, tws } from "./styles";
import type { MailAcct, MailCfg, Message } from "./types";

export type MailNew = {
  email: string;
  keychain_service: string;
  keychain_account: string;
  password: string;
  host: string;
  port: string;
};

declare global {
  interface HTMLElementTagNameMap {
    "relay-settings-mail": SettingsMail;
  }
  interface HTMLElementEventMap {
    "mail-new": CustomEvent<{ key: keyof MailNew; value: string }>;
    "mail-account": CustomEvent<string>;
    "mail-test": CustomEvent<MailAcct>;
    "mail-drop": CustomEvent<MailAcct>;
    "mail-connect": CustomEvent<boolean>; // whether it is a server other than Gmail
    "mail-add": CustomEvent<void>;
    "mail-save": CustomEvent<void>;
    /** a new add step starts without the last try's message */
    "mail-message-clear": CustomEvent<void>;
  }
}

// a step of the account guide: a small grid of its own, the ones after the first below a line
const STEP = "grid justify-items-start gap-2 [&>*]:max-w-full";
const NEXT_STEP = `${STEP} border-t border-s-border pt-3.5`;
const STEP_TITLE = "text-[13px] font-medium text-s-fg";
const PARA = `text-[13px] leading-snug text-s-fg ${CODE}`;

type AddKind = "gmail" | "imap" | "keychain";

// the backend's errors we know what to do about, each with the text that says it
const KNOWN_ERRORS: [RegExp, Key][] = [
  [/^Login failed/, "mail.errLogin"],
  [/No password in the keychain/, "mail.errNoPw"],
  [/not approved in time/, "mail.errKeychain"],
  [/Only Gmail/, "mail.errGmail"],
  [/IMAP (connection|timeout|protocol)|did not answer in time/, "mail.errNet"],
];

/** Mail's body in the integrations list: the accounts, and the steps to connect another. No password of our own either,
 *  the app reads the app password from the macOS keychain. Edits stay local until Save. */
@customElement("relay-settings-mail")
export class SettingsMail extends SettingsElement {
  // its sections sit in the page's column, like the page's own
  static override styles = [tws, contents];

  @property({ attribute: false }) config!: MailCfg;
  /** What sits in the add fields */
  @property({ attribute: false }) newAccount!: MailNew;
  @property({ attribute: false }) tests: Record<string, Message | "busy"> = {};
  /** "connect" or "advanced" while that step runs */
  @property() busy = "";
  @property() message = "";
  @property({ type: Boolean }) ok = false;
  /** the kind of account being added, its steps shown instead of the list; "" for the list */
  @state() private adding: "" | AddKind = "";

  // a step that ends well (the account connected and saved) brings the list back, with its message
  override willUpdate(changed: PropertyValues<this>) {
    if (changed.get("busy") && !this.busy && this.ok) this.adding = "";
  }

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
    return html`<div
      class="group flex items-center gap-3 border-t border-s-border py-2.5 first:border-t-0 first:pt-0 last:pb-0"
    >
      <span class="min-w-0 flex-1"
        ><b class="block truncate font-medium">${account.email}</b
        ><span class="block truncate text-xs text-s-muted"
          >${t("mail.inKeychain", { svc: account.keychain_service })}${account.host ? ` · ${account.host}` : ""}</span
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
    if (!this.config.accounts.length) return html`<p class=${HINT_IN_ROW}>${t("mail.setupIntro")}</p>`;
    return html`<div>${this.config.accounts.map(account => this.renderAccount(account))}</div>`;
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
    return field(t("mail.account"), select, {
      id: "mailacct",
      hint: t("mail.accountHint"),
      classes: "border-t border-s-border pt-3.5",
    });
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

  private renderPasswordField(label: Key, placeholder?: Key) {
    const input = html`<input
      class=${FIELD}
      id="mailpw"
      type="password"
      .value=${live(this.newAccount.password)}
      @input=${this.onNewField("password")}
      placeholder=${placeholder ? t(placeholder) : ""}
      autocomplete="off"
      spellcheck="false"
    />`;
    return field(withoutColon(t(label)), input, { id: "mailpw", classes: "w-full" });
  }

  private renderSaveRow() {
    const message = this.message && (this.ok ? this.message : this.explainError(this.message));
    const save = html`<button class=${buttonClass("primary")} @click=${() => emit(this, "mail-save")}>
      ${t("set.save")}
    </button>`;
    return removeFooter(() => emit(this, "int-remove"), message, this.ok, save);
  }

  // the add steps' button, with the busy spinner or the message of the last try before it
  private renderAddButton(step: string, label: Key, click: () => void) {
    const message = this.busy === step ? this.renderBusy(step) : this.message && this.explainError(this.message);
    const button = html`<button class=${buttonClass("primary")} @click=${click} ?disabled=${!!this.busy}>
      ${t(label)}
    </button>`;
    return html`<div class="${FOOTER_IN_ROW} justify-self-stretch">${footer(message, this.ok, button)}</div>`;
  }
  private renderConnectButton(imap: boolean) {
    return this.renderAddButton("connect", "mail.connect", () => emit(this, "mail-connect", imap));
  }

  private renderGmailSteps() {
    return html`<div class=${STEP}>
        <b class=${STEP_TITLE}>${t("mail.step1H")}</b>
        <p class=${PARA}>${th("mail.step1")}</p>
        <p class=${HINT_IN_ROW}>${th("mail.step1Hint")}</p>
        <a class=${buttonClass()} href="https://myaccount.google.com/apppasswords" target="_blank"
          >${t("mail.step1Btn")}</a
        >
      </div>
      <div class=${NEXT_STEP}>
        <b class=${STEP_TITLE}>${t("mail.step2H")}</b>
        ${this.renderEmailField("mailnew")} ${this.renderPasswordField("mail.pwL", "mail.pwPh")}
        <p class=${HINT_IN_ROW}>${th("mail.step2Hint")}</p>
        ${this.renderConnectButton(false)}
      </div>`;
  }

  private renderImapSteps() {
    return html`<div class=${STEP}>
      ${this.renderEmailField("mailnew")}
      ${this.renderTextField("mailhost", t("mail.hostL"), "host", "mail.example.com")}
      ${this.renderTextField("mailport", t("mail.portL"), "port", "993")} ${this.renderPasswordField("mail.imapPwL")}
      <p class=${HINT_IN_ROW}>${th("mail.imapHint")}</p>
      ${this.renderConnectButton(true)}
    </div>`;
  }

  // the steps to add an account of the picked kind, in place of the list until it is added or cancelled
  private renderAdding(kind: AddKind) {
    const titles: Record<AddKind, Key> = {
      gmail: "mail.guideH",
      imap: "mail.guideImap",
      keychain: "mail.kindKeychain",
    };
    const steps = {
      gmail: this.renderGmailSteps(),
      imap: this.renderImapSteps(),
      keychain: this.renderKeychainSteps(),
    };
    const cancel = html`<button class=${buttonClass("ghost")} @click=${() => (this.adding = "")}>
      ${t("pop.cancel")}
    </button>`;
    const desc = kind === "keychain" ? th("mail.adv") : undefined;
    return section(t(titles[kind]), steps[kind], { desc, action: cancel });
  }

  // without the app password: an account whose password already sits in the keychain (himalaya's, say)
  private renderKeychainSteps() {
    return html`<div class=${STEP}>
      ${this.renderEmailField("mailemail2")}
      ${this.renderTextField("mailhost2", t("mail.advHostL"), "host", "mail.example.com")}
      ${this.renderTextField("mailport2", t("mail.portL"), "port", "993")}
      ${this.renderTextField("mailsvc", t("mail.svcL"), "keychain_service", "himalaya-weareantenna-imap")}
      ${this.renderTextField("mailkacc", t("mail.kaccL"), "keychain_account", "weareantenna")}
      ${this.renderAddButton("advanced", "mail.addTest", () => emit(this, "mail-add"))}
    </div>`;
  }

  // the kinds of account to add, like the Add menus of integrations and agents
  private renderAddMenu() {
    const items = [
      { id: "gmail", name: t("mail.kindGmail") },
      { id: "imap", name: t("mail.kindImap") },
      { id: "keychain", name: t("mail.kindKeychain") },
    ];
    return html`<relay-settings-menu
      .label=${t("mail.add")}
      .items=${items}
      @menu-pick=${(e: CustomEvent<string>) => {
        emit(this, "mail-message-clear");
        this.adding = e.detail as AddKind;
      }}
    ></relay-settings-menu>`;
  }

  override render() {
    if (this.adding) return this.renderAdding(this.adding);
    const accounts = html`${this.renderAccounts()} ${this.renderAccountChoice()} ${this.renderSaveRow()}`;
    return section(t("mail.accountsH"), accounts, { desc: t("mail.help"), action: this.renderAddMenu() });
  }
}
