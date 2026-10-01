import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import { md } from "../../core/markdown";
import { tw } from "../../core/styles";

/** What the agent answered, as markdown. */
@customElement("relay-answer")
export class Answer extends LitElement {
  static styles = [
    tw,
    css`
      :host {
        display: block;
      }
    `,
  ];
  @property() text = "";

  render() {
    return html`<div class="md-chat [&_a:not(.vlink)]:underline [&_strong]:font-bold!">${md(this.text)}</div>`;
  }
}
