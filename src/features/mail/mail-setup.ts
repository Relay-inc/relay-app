import { LitElement, css, html } from "lit";
import { customElement } from "lit/decorators.js";
import { th } from "../../core/i18n";
import { emit } from "../../core/dom";
import { tw } from "../../core/styles";

declare global {
  interface HTMLElementEventMap {
    setup: CustomEvent<void>;
  }
}

/** No account yet: what to do in three steps, and the way into the settings. The texts are the app's own. */
@customElement("relay-mail-setup")
export class MailSetup extends LitElement {
  static override styles = [
    tw,
    css`
      :host {
        display: block;
      }
    `,
  ];
  override render() {
    return html`<div class="max-w-lg my-8 mx-auto px-6 py-6 border border-separator rounded-xl bg-fill">
      <h2 class="text-base font-semibold mb-1.5">${th("mail.setupTitle")}</h2>
      <p class="mb-3 text-sm leading-normal">${th("mail.setupIntro")}</p>
      <ol
        class="mb-3.5 pl-5 text-sm leading-relaxed list-decimal [&_li]:mb-1.5 [&_code]:font-mono [&_code]:text-xs [&_code]:bg-fill [&_code]:px-1 [&_code]:py-px [&_code]:rounded-sm"
      >
        <li>${th("mail.setupStep1")}</li>
        <li>${th("mail.setupStep2")}</li>
        <li>${th("mail.setupStep3")}</li>
      </ol>
      <p class="mb-3 text-secondary text-sm">${th("mail.setupPw")}</p>
      <button class="btn btn-primary" @click=${() => emit(this, "setup")}>${th("mail.setupOpen")}</button>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-mail-setup": MailSetup;
  }
}
