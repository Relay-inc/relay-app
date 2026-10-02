import type { ReactiveControllerHost } from "lit";
import { invoke } from "@tauri-apps/api/core";
import { t } from "../../core/i18n";
import type { MailNew } from "./settings-mail";
import type { MailAcct, MailCfg, Message, Settings } from "./types";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What the integrations page gives its controllers: the settings as saved, and a way to say they changed. */
export type IntegrationsHost = ReactiveControllerHost & { settings: Settings; commit(settings: Settings): void };

/** Mail's state and calls, kept by the integrations page so they survive the row folding shut. */
export class MailController {
  edit!: MailCfg;
  newAccount: MailNew = {
    email: "",
    keychain_service: "",
    keychain_account: "",
    password: "",
    host: "",
    port: "993",
  }; // what sits in the add fields
  busy = ""; // "connect" or "advanced" while that step runs
  message = "";
  ok = false;
  tests: Record<string, Message | "busy"> = {};
  constructor(private host: IntegrationsHost) {}

  load() {
    this.edit = { ...this.host.settings.mail, accounts: this.host.settings.mail?.accounts ?? [] };
  }
  private redraw() {
    this.host.requestUpdate();
  }

  private fail(message: string) {
    this.message = message;
    this.ok = false;
  }

  drop(account: MailAcct) {
    delete this.tests[account.email];
    this.edit.accounts = this.edit.accounts.filter(x => x.email !== account.email);
    if (this.edit.account === account.email) this.edit.account = "";
    this.redraw();
  }

  // add an account that passed its test and save at once, so nothing is left half set up
  private async keep(account: MailAcct, testResult: string) {
    const others = this.edit.accounts.filter(x => x.email.toLowerCase() !== account.email.toLowerCase());
    this.edit.accounts = [...others, account];
    const saved = await invoke<Settings>("set_settings", {
      settings: { ...this.host.settings, mail: { ...this.edit, on: true } },
    });
    this.host.commit(saved);
    this.load();
    this.tests[account.email] = { text: testResult, ok: true };
    this.message = t("mail.connected", { email: account.email, n: (testResult.match(/\d+/) || ["?"])[0] });
    this.ok = true;
    Object.assign(this.newAccount, {
      email: "",
      password: "",
      keychain_service: "",
      keychain_account: "",
      host: "",
      port: "993",
    });
  }

  // "connect" and "advanced" both end here: busy while the step runs, the error shown when it fails
  private async runStep(step: string, work: () => Promise<void>) {
    this.busy = step;
    this.message = "";
    this.redraw();
    try {
      await work();
    } catch (error) {
      this.fail(String(error));
    }
    this.busy = "";
    this.redraw();
  }

  // connect with an app password (Gmail) or a password and server (imap): the backend stores it in the keychain and tests the login
  async connect(imap: boolean) {
    const draft = this.newAccount;
    if (!EMAIL.test(draft.email.trim())) {
      this.fail(t("mail.invalid"));
      this.redraw();
      return;
    }
    await this.runStep("connect", async () => {
      const connected = await invoke<{ account: MailAcct; result: string }>("mail_connect", {
        email: draft.email,
        password: draft.password,
        ...(imap ? { host: draft.host.trim(), port: Number(draft.port) || 993 } : {}),
      });
      await this.keep(connected.account, connected.result);
    });
    draft.password = "";
    this.redraw();
  }

  // add an account whose password already sits in the keychain
  async add() {
    const draft = this.newAccount;
    const host = draft.host.trim();
    const account: MailAcct = {
      email: draft.email.trim(),
      keychain_service: draft.keychain_service.trim(),
      keychain_account: draft.keychain_account.trim(),
      ...(host ? { host, port: Number(draft.port) || 993 } : {}),
    };
    if (!EMAIL.test(account.email) || !account.keychain_service || !account.keychain_account) {
      this.fail(t("mail.invalid"));
      this.redraw();
      return;
    }
    await this.runStep("advanced", async () => {
      await this.keep(account, await invoke<string>("mail_test", { account }));
    });
  }

  async test(account: MailAcct) {
    this.tests[account.email] = "busy";
    this.redraw();
    try {
      this.tests[account.email] = { text: await invoke<string>("mail_test", { account }), ok: true };
    } catch (error) {
      this.tests[account.email] = { text: String(error), ok: false };
    }
    this.redraw();
  }

  async save() {
    try {
      const saved = await invoke<Settings>("set_settings", { settings: { ...this.host.settings, mail: this.edit } });
      this.host.commit(saved);
      this.load();
      this.message = t("set.saved");
      this.ok = true;
    } catch (error) {
      this.fail(String(error));
    }
    this.redraw();
  }
}
