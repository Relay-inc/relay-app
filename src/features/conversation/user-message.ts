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
    return html`${this.imgs.length ? html`<relay-image-thumbs class="self-end max-w-[80%] -mb-[10px]" size="message" .urls=${this.imgs}></relay-image-thumbs>` : nothing}${this.text
      ? html`<div class="self-end max-w-[80%] bg-fill rounded-lg px-[14px] py-[9px] text-xl leading-[1.45]">${lines(this.text)}</div>` : nothing}`;
  }
}
