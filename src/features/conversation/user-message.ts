import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { tw } from "../../core/styles";
import "../../components/image-thumbs";

const lines = (text: string) => text.split("\n").map((line, i) => html`${i ? html`<br />` : nothing}${line}`);

/** What the user sent: its images over a bubble with the text. Its children sit in the conversation's column. */
@customElement("relay-user-message")
export class UserMessage extends LitElement {
  static override styles = [
    tw,
    css`
      :host {
        display: contents;
      }
    `,
  ];
  @property() text = "";
  @property({ attribute: false }) imgs: string[] = [];

  override render() {
    return html`${this.imgs.length ? html`<relay-image-thumbs class="self-end max-w-[78%] -mb-2.5" size="message" .urls=${this.imgs}></relay-image-thumbs>` : nothing}${
      this.text
        ? html`<div
            class="self-end max-w-[78%] bg-fill-2 rounded-[14px_14px_4px_14px] px-3.5 py-2.25 text-[15px] leading-normal wrap-anywhere"
          >
            ${lines(this.text)}
          </div>`
        : nothing
    }`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-user-message": UserMessage;
  }
}
