import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { t } from "../../core/i18n";
import { emit } from "../../core/dom";
import { md } from "../../core/markdown";
import { tw } from "../../core/styles";
import { toolLine } from "../../components/tool-line";

declare global {
  interface HTMLElementEventMap {
    toggle: CustomEvent<void>;
  }
}

/** One agent: a line (description, what it is, the step it is on, how long), and its last messages while unfolded (`toggle` on a click).
 *  Its two children sit in the list's column. */
@customElement("relay-subagent-row")
export class SubagentRow extends LitElement {
  static override styles = [
    tw,
    css`
      :host {
        display: contents;
      }
    `,
  ];
  @property() description = "";
  @property() meta = "";
  // the step a running agent is on: a tool call, else what it said (a template is not a property value, the row draws the call)
  @property() tool = "";
  @property({ attribute: false }) input: any;
  @property() text = "";
  @property() duration = "";
  @property({ type: Boolean }) running = false;
  /** The last messages while unfolded, else undefined. */
  @property({ attribute: false }) log?: string[];

  override render() {
    return html`<div
        class="flex items-center gap-2 min-h-6 px-1.5 rounded-md text-sm text-secondary cursor-default select-none hover:bg-fill"
        title=${t("subs.show")}
        @click=${() => emit(this, "toggle")}
      >
        <span
          class=${this.running ? "size-2 flex-none rounded-full bg-accent animate-pulse-dot" : "size-2 flex-none rounded-full bg-separator"}
        ></span>
        <span
          class=${this.running ? "text-label flex-initial min-w-0 whitespace-nowrap overflow-hidden text-ellipsis" : "flex-initial min-w-0 whitespace-nowrap overflow-hidden text-ellipsis"}
          >${this.description}</span
        >
        <span class="flex-none text-xs whitespace-nowrap">${this.meta}</span>
        <span
          class="flex-1 min-w-0 whitespace-nowrap overflow-hidden text-ellipsis text-xs [&_code]:font-mono [&_code]:text-xs"
          >${this.running ? (this.tool ? toolLine(this.tool, this.input) : this.text) : ""}</span
        >
        <span class=${this.running ? "flex-none tabular-nums" : "flex-none text-xs whitespace-nowrap"}
          >${this.duration}</span
        >
      </div>
      ${
        this.log
          ? html`<div class="mt-0.5 mb-1.5 ml-5 px-3 py-2 border-l border-separator grid gap-2">
              ${
                this.log.length
                  ? this.log.map(
                      m =>
                        html`<div
                          class="md-chat [&_a:not(.vlink)]:underline [&_strong]:font-bold! text-sm! leading-normal!"
                        >
                          ${md(m)}
                        </div>`,
                    )
                  : html`<div class="text-xs text-secondary">${t("subs.nothing")}</div>`
              }
            </div>`
          : nothing
      }`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-subagent-row": SubagentRow;
  }
}
