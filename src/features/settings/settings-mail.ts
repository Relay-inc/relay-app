import { html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { emit } from "../../core/dom";
import { currentLocale, t, th } from "../../core/i18n";
import { btn, CODE, ERRMSG, field, FIELD, foot, FOOT_ROW, HINT, HINT0, nc, OKMSG, SELECT, val } from "./blocks";
import { SettingsElement } from "./settings-element";
import { tws } from "./styles";
import type { MailAcct, MailCfg, Msg } from "./types";

export type MailNew = { email: string; keychain_service: string; keychain_account: string; pw: string };

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

/** Mail's body in the integrations list: the accounts, and the steps to connect another. No password of our own either,
 *  the app reads the app password from the macOS keychain. Edits stay local until Save. */
@customElement("relay-settings-mail")
export class SettingsMail extends SettingsElement {
  static override styles = [tws];

  @property({ attribute: false }) cfg!: MailCfg;
  /** What sits in the add fields */
  @property({ attribute: false }) fresh!: MailNew;
  @property({ attribute: false }) tests: Record<string, Msg | "busy"> = {};
  /** "connect" or "advanced" while that step runs */
  @property() busy = "";
  @property() msg = "";
  @property({ type: Boolean }) ok = false;

  // a backend error as what to do about it, with the raw message small below for when it is something else
  private err(e: string) {
    const k = /^Login failed/.test(e)
      ? "mail.errLogin"
      : /No password in the keychain/.test(e)
        ? "mail.errNoPw"
        : /not approved in time/.test(e)
          ? "mail.errKeychain"
          : /Only Gmail/.test(e)
            ? "mail.errGmail"
            : /IMAP (connection|timeout|protocol)/.test(e)
              ? "mail.errNet"
              : "";
    return k
      ? html`${t(k)}
          <div class=${HINT}>${e}</div>`
      : e;
  }
  private input = (key: keyof MailNew) => (e: Event) => emit(this, "mail-new", { key, value: val(e) });

  override render() {
    const c = this.cfg,
      mn = this.fresh;
    const tr = (a: MailAcct) => {
      const r = this.tests[a.email];
      return r === "busy"
        ? html`<span class="spinner"></span>`
        : r
          ? html`<span class=${r.ok ? OKMSG : ERRMSG}
              >${r.ok ? t("mail.testOk", { n: Number((r.text.match(/\d+/) || ["0"])[0]).toLocaleString(currentLocale()) }) : this.err(r.text)}</span
            >`
          : nothing;
    };
    const busy = (k: string) =>
      this.busy === k ? html`<span class="spinner"></span> ${t("mail.connecting")}` : nothing;
    const accts = c.accounts.map(
      a =>
        html`<div class="group flex items-center gap-3 border-t border-s-border py-2.5 first:border-t-0">
          <span class="min-w-0 flex-1"
            ><b class="block truncate font-medium">${a.email}</b
            ><span class="block truncate text-xs text-s-muted"
              >${t("mail.inKeychain", { svc: a.keychain_service })}</span
            ></span
          >${tr(a)}
          <span
            class="flex items-center gap-1 opacity-0 transition-opacity duration-150 ease-in-out group-focus-within:opacity-100 group-hover:opacity-100"
            ><button class=${btn()} @click=${() => emit(this, "mail-test", a)}>${t("mail.test")}</button
            ><button class=${btn("ghost")} @click=${() => emit(this, "mail-drop", a)}>${t("mail.remove")}</button></span
          >
        </div>`,
    );
    const emailIn = (id: string) =>
      field(
        nc(t("mail.emailL")),
        html`<input
          class=${FIELD}
          id=${id}
          type="email"
          .value=${live(mn.email)}
          @input=${this.input("email")}
          placeholder="naam@bedrijf.be"
          spellcheck="false"
          autocomplete="off"
        />`,
        { id, cls: "w-full" },
      );
    return html`<p class=${HINT0}>${t("mail.help")}</p>
      ${
        accts.length
          ? html`<div class=${SUB}><b class="text-xs font-semibold">${t("mail.accountsH")}</b></div>
              <div class="rounded-md border border-s-border px-3">${accts}</div>`
          : nothing
      }
      ${
        c.accounts.length > 1
          ? field(
              nc(t("mail.account")),
              html`<select class=${SELECT} id="mailacct" @change=${(e: Event) => emit(this, "mail-account", val(e))}>
                ${c.accounts.map(
                  a =>
                    html`<option value=${a.email} ?selected=${a.email === (c.account || c.accounts[0].email)}>
                      ${a.email}
                    </option>`,
                )}
              </select>`,
              { id: "mailacct" },
            )
          : nothing
      }
      <div class=${FOOT_ROW}>
        <button class=${btn("ghost")} @click=${() => emit(this, "int-remove")}>${t("ag.remove")}</button
        >${foot(this.msg && (this.ok ? this.msg : this.err(this.msg)), this.ok, html`<button class=${btn("primary")} @click=${() => emit(this, "mail-save")}>${t("set.save")}</button>`)}
      </div>
      <div class=${SUB}>
        <b class="text-xs font-semibold">${c.accounts.length ? t("mail.guideMore") : t("mail.guideH")}</b>
      </div>
      <div class=${STEP}>
        <b class="font-medium">${t("mail.step1H")}</b>
        <p class=${PARA}>${th("mail.step1")}</p>
        <a class=${btn()} href="https://myaccount.google.com/apppasswords" target="_blank">${t("mail.step1Btn")}</a>
        <p class=${HINT_STEP}>${th("mail.step1Hint")}</p>
      </div>
      <div class=${STEP}>
        <b class="font-medium">${t("mail.step2H")}</b>
        ${emailIn("mailnew")}
        ${field(nc(t("mail.pwL")), html`<input class=${FIELD} id="mailpw" type="password" .value=${live(mn.pw)} @input=${this.input("pw")} placeholder=${t("mail.pwPh")} autocomplete="off" spellcheck="false" />`, { id: "mailpw", cls: "w-full" })}
        <div class="flex items-center gap-2">
          <button class=${btn("primary")} @click=${() => emit(this, "mail-connect")} ?disabled=${!!this.busy}>
            ${t("mail.connect")}</button
          >${busy("connect")}
        </div>
        <p class=${HINT_STEP}>${th("mail.step2Hint")}</p>
      </div>
      <details class=${STEP} ?open=${!!mn.keychain_service}>
        <summary class="font-medium">${t("mail.advH")}</summary>
        <p class=${HINT_STEP}>${th("mail.adv")}</p>
        ${emailIn("mailemail2")}
        ${field(nc(t("mail.svcL")), html`<input class=${FIELD} id="mailsvc" .value=${live(mn.keychain_service)} @input=${this.input("keychain_service")} placeholder="himalaya-weareantenna-imap" spellcheck="false" />`, { id: "mailsvc", cls: "w-full" })}
        ${field(nc(t("mail.kaccL")), html`<input class=${FIELD} id="mailkacc" .value=${live(mn.keychain_account)} @input=${this.input("keychain_account")} placeholder="weareantenna" spellcheck="false" />`, { id: "mailkacc", cls: "w-full" })}
        <div class="flex items-center gap-2">
          <button class=${btn()} @click=${() => emit(this, "mail-add")} ?disabled=${!!this.busy}>
            ${t("mail.addTest")}</button
          >${busy("advanced")}
        </div>
      </details>`;
  }
}
