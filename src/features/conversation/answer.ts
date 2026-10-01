import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { md } from "../../core/markdown";
import { copyText } from "../../core/dom";
import { t } from "../../core/i18n";
import { icon } from "../../core/icons";
import { tw } from "../../core/styles";

/** What the agent answered, as markdown, with a button on hover that copies it as written. */
@customElement("relay-answer")
export class Answer extends LitElement {
  static override styles = [
    tw,
    css`
      :host {
        display: block;
      }
    `,
  ];
  @property() text = "";
  @state() private copied = false;

  private copy() {
    copyText(this.text);
    this.copied = true;
    setTimeout(() => (this.copied = false), 1200);
  }

  override render() {
    return html`<div class="group">
      <div class="md-chat [&_a:not(.vlink)]:underline [&_strong]:font-bold!">${md(this.text)}</div>
      <button
        class="grid place-items-center size-6 -ml-1 mt-1 rounded-sm border-0 bg-transparent text-secondary hover:bg-fill opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        title=${t("copy")}
        aria-label=${t("copy")}
        @click=${this.copy}
      >
        ${icon(this.copied ? "check" : "copy", "glyph size-3.5")}
      </button>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-answer": Answer;
  }
}
