import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { tw } from "../../core/styles";
import { emit } from "../../core/dom";
import { icon } from "../../core/icons";
import { toolLine, changeOf } from "../../components/tool-line";
import type { ToolInput } from "../../domain/chats/state";

declare global {
  interface HTMLElementEventMap {
    "open-note": CustomEvent<void>;
  }
}

/** One tool call, a line with its icon, and the change it made when the call carries one. A step on a note that exists is a link (`open-note`). */
@customElement("relay-tool-step")
export class ToolStep extends LitElement {
  static override styles = [
    tw,
    css`
      :host {
        display: block;
      }
    `,
  ];
  @property({ attribute: false }) tool?: { name: string; input: ToolInput };
  @property() text = "";
  @property() state: "run" | "ok" | "err" | "" = "";
  @property({ type: Boolean }) link = false;
  @state() private open = false; // a command shown in full under its line

  private glyph() {
    const name = this.tool?.name ?? "";
    if (this.state === "run") return html`<span class="spinner"></span>`;
    const kind = /^(Edit|MultiEdit|Write)$/.test(name)
      ? "edit"
      : /^(Grep|Glob|WebSearch)$/.test(name)
        ? "search"
        : name === "Bash"
          ? "term"
          : "file";
    return icon(kind, "glyph size-3.5 flex-none");
  }

  private renderDiff(change: NonNullable<ReturnType<typeof changeOf>>) {
    const row = (sign: string, line: string, colour: string) =>
      html`<div class="px-3 whitespace-pre-wrap wrap-anywhere ${colour}">${sign} ${line}</div>`;
    if (!change.del.length && !change.add.length) return nothing;
    return html`<div
      class="my-1 border border-separator rounded-lg overflow-hidden font-mono text-xs leading-[1.7] max-h-60 overflow-y-auto"
    >
      ${change.del.map(line => row("−", line, "bg-del-bg text-del-fg"))}
      ${change.add.map(line => row("+", line, "bg-add-bg text-add-fg"))}
    </div>`;
  }

  override render() {
    const change = this.tool ? changeOf(this.tool.name, this.tool.input) : null;
    const command = this.tool?.name === "Bash" ? String(this.tool.input?.command || "") : "";
    const click = this.link ? () => emit(this, "open-note") : command ? () => (this.open = !this.open) : null;
    const cls = `flex items-center gap-2 h-6 min-w-0 text-[13px] [&_code]:whitespace-nowrap [&_code]:font-mono [&_code]:text-xs [&_code]:bg-fill-2 [&_code]:text-label [&_code]:px-1.25 [&_code]:py-px [&_code]:rounded-sm ${this.state === "err" ? "text-label" : "text-secondary"}${this.link ? " cursor-pointer hover:underline" : command ? " cursor-pointer hover:text-label" : ""}`;
    return html`<div class=${cls} @click=${click}>
        ${this.glyph()}<span class="min-w-0 truncate"
          >${this.tool ? toolLine(this.tool.name, this.tool.input, this.link) : this.text}</span
        >
        ${change?.add.length ? html`<span class="font-mono text-[11px] text-add-fg">+${change.add.length}</span>` : nothing}
        ${change?.del.length ? html`<span class="font-mono text-[11px] text-del-fg">−${change.del.length}</span>` : nothing}
      </div>
      ${
        this.open && command
          ? html`<pre
              class="my-1 px-3 py-2 bg-well border border-separator rounded-lg font-mono text-xs leading-[1.6] text-label whitespace-pre-wrap wrap-anywhere select-text max-h-60 overflow-y-auto"
            >
${command}</pre>`
          : nothing
      }
      ${change ? this.renderDiff(change) : nothing}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-tool-step": ToolStep;
  }
}
