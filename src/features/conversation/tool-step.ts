import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import { tw } from "../../core/styles";
import { emit } from "../../core/dom";
import { toolLine } from "../../components/tool-line";

declare global {
  interface HTMLElementEventMap {
    "open-note": CustomEvent<void>;
  }
}

/** One tool call, a quiet line between the messages. A step on a note that exists is a link (`open-note`). */
@customElement("relay-tool-step")
export class ToolStep extends LitElement {
  static styles = [tw, css`:host{display:block}`];
  @property({ attribute: false }) tool?: { name: string; input: any };
  @property() text = "";
  @property() state: "run" | "ok" | "err" | "" = "";
  @property({ type: Boolean }) link = false;

  render() {
    // the arrow before the line; a running step has a spinner instead
    const lead = this.state === "run"
      ? "before:size-[9px] before:rounded-full before:border-[1.5px] before:border-separator before:border-t-secondary before:animate-spin"
      : "before:w-0 before:h-0 before:border-l-[5px] before:border-l-current before:border-y-4 before:border-y-transparent before:opacity-60";
    const cls = `flex items-center gap-2 text-sm [&_code]:font-mono [&_code]:text-[12.5px] before:content-[''] ${lead} ${this.state === "err" ? "text-label" : "text-secondary"}${this.link ? " cursor-pointer hover:underline" : ""}`;
    return html`<div class=${cls} @click=${this.link ? () => emit(this, "open-note") : null}>${this.tool ? toolLine(this.tool.name, this.tool.input) : this.text}</div>`;
  }
}
