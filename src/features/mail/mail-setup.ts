import { LitElement, css, html } from "lit";
import { customElement } from "lit/decorators.js";
import { th } from "../../core/i18n";
import { emit } from "../../core/dom";
import { tw } from "../../core/styles";

declare global { interface HTMLElementEventMap { "setup": CustomEvent<void>; } }

/** No account yet: what to do in three steps, and the way into the settings. The texts are the app's own. */
@customElement("relay-mail-setup")
export class MailSetup extends LitElement {
  static styles = [tw, css`:host { display: block; }`];
  render() {
    return html`<div class="max-w-[540px] my-8 mx-auto px-[26px] py-[22px] border border-separator rounded-2xl bg-fill">
      <h2 class="text-xl font-semibold mb-1.5">${th("mail.setupTitle")}</h2><p class="mb-3 text-sm leading-[1.5]">${th("mail.setupIntro")}</p>
      <ol class="mb-[14px] pl-5 text-sm leading-[1.6] list-decimal [&_li]:mb-1.5 [&_code]:font-mono [&_code]:text-xs [&_code]:bg-fill [&_code]:px-[5px] [&_code]:py-px [&_code]:rounded-xs"><li>${th("mail.setupStep1")}</li><li>${th("mail.setupStep2")}</li><li>${th("mail.setupStep3")}</li></ol>
      <p class="mb-3 text-secondary text-sm">${th("mail.setupPw")}</p>
      <button class="btn btn-primary" @click=${() => emit(this, "setup")}>${th("mail.setupOpen")}</button></div>`;
  }
}
