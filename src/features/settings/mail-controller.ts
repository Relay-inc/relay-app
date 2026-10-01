import type { ReactiveControllerHost } from "lit";
import { invoke } from "@tauri-apps/api/core";
import { t } from "../../core/i18n";
import type { MailNew } from "./settings-mail";
import type { MailAcct, MailCfg, Msg, Settings } from "./types";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What the integrations page gives its controllers: the settings as saved, and a way to say they changed. */
export type IntHost = ReactiveControllerHost & { settings: Settings; commit(s: Settings): void };

/** Mail's state and calls, kept by the integrations page so they survive the row folding shut. */
export class MailController {
  edit!: MailCfg;
  fresh: MailNew = { email: "", keychain_service: "", keychain_account: "", pw: "" }; // what sits in the add fields
  busy = ""; // "connect" or "advanced" while that step runs
  msg = "";
  ok = false;
  tests: Record<string, Msg | "busy"> = {};
  constructor(private h: IntHost) {}

  load() {
    this.edit = { ...this.h.settings.mail, accounts: this.h.settings.mail?.accounts ?? [] };
  }
  private up() {
    this.h.requestUpdate();
  }

  drop(a: MailAcct) {
    delete this.tests[a.email];
    this.edit.accounts = this.edit.accounts.filter(x => x.email !== a.email);
    if (this.edit.account === a.email) this.edit.account = "";
    this.up();
  }
  // add an account that passed its test and save at once, so nothing is left half set up
  private async keep(a: MailAcct, result: string) {
    this.edit.accounts = [...this.edit.accounts.filter(x => x.email.toLowerCase() !== a.email.toLowerCase()), a];
    this.h.commit(
      await invoke<Settings>("set_settings", { settings: { ...this.h.settings, mail: { ...this.edit, on: true } } }),
    );
    this.load();
    this.tests[a.email] = { text: result, ok: true };
    this.msg = t("mail.connected", { email: a.email, n: (result.match(/\d+/) || ["?"])[0] });
    this.ok = true;
    Object.assign(this.fresh, { email: "", pw: "", keychain_service: "", keychain_account: "" });
  }
  async connect() {
    const mn = this.fresh;
    if (!EMAIL.test(mn.email.trim())) {
      this.msg = t("mail.invalid");
      this.ok = false;
      this.up();
      return;
    }
    this.busy = "connect";
    this.msg = "";
    this.up();
    try {
      const r = await invoke<{ account: MailAcct; result: string }>("mail_connect", {
        email: mn.email,
        password: mn.pw,
      });
      await this.keep(r.account, r.result);
    } catch (x) {
      this.msg = String(x);
      this.ok = false;
    }
    this.busy = "";
    mn.pw = "";
    this.up();
  }
  async add() {
    const mn = this.fresh,
      a = {
        email: mn.email.trim(),
        keychain_service: mn.keychain_service.trim(),
        keychain_account: mn.keychain_account.trim(),
      };
    if (!EMAIL.test(a.email) || !a.keychain_service || !a.keychain_account) {
      this.msg = t("mail.invalid");
      this.ok = false;
      this.up();
      return;
    }
    this.busy = "advanced";
    this.msg = "";
    this.up();
    try {
      await this.keep(a, await invoke<string>("mail_test", { account: a }));
    } catch (x) {
      this.msg = String(x);
      this.ok = false;
    }
    this.busy = "";
    this.up();
  }
  async test(a: MailAcct) {
    this.tests[a.email] = "busy";
    this.up();
    try {
      this.tests[a.email] = { text: await invoke<string>("mail_test", { account: a }), ok: true };
    } catch (x) {
      this.tests[a.email] = { text: String(x), ok: false };
    }
    this.up();
  }
  async save() {
    try {
      this.h.commit(await invoke<Settings>("set_settings", { settings: { ...this.h.settings, mail: this.edit } }));
      this.load();
      this.msg = t("set.saved");
      this.ok = true;
    } catch (x) {
      this.msg = String(x);
      this.ok = false;
    }
    this.up();
  }
}
