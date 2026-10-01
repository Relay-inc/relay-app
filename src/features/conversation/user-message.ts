import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { tw } from "../../core/styles";
import "../../components/image-thumbs";

const lines = (text: string) => text.split("\n").map((l, i) => html`${i ? html`<br>` : nothing}${l}`);

/** What the user sent: its images over a bubble with the text. Its children sit in the conversation's column. */
@customElement("relay-user-message")
export class UserMessage extends LitElement {
  static styles = [tw, css`:host{display:contents}`];
  @property() text = "";
  @property({ attribute: false }) imgs: string[] = [];

  render() {
    return html`${this.imgs.length ? html`<relay-image-thumbs class="self-end max-w-4/5 -mb-2.5" size="message" .urls=${this.imgs}></relay-image-thumbs>` : nothing}${this.text
      ? html`<div class="self-end max-w-4/5 bg-fill rounded-lg px-3.5 py-2 text-base leading-normal">${lines(this.text)}</div>` : nothing}`;
  }
}
