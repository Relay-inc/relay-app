import { LitElement, html, css, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { tn } from "../../core/i18n";
import { StoreController } from "../../core/store";
import { tw } from "../../core/styles";
import { ui } from "../../domain/ui";
import { chat, formatDuration } from "../../domain/chats/state";
import type { Sub } from "../../domain/chats/state";
import { toggleSubLog, toggleSubsDone } from "../../domain/chats/actions";
import "./subagent-row";

/** The agents of the open conversation above the composer, like the terminal lists them under the prompt: the running ones, and the finished ones folded away. */
@customElement("relay-subagents")
export class RelaySubagents extends LitElement {
  static override styles = [
    tw,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: 2px;
        max-height: 40vh;
        overflow-y: auto;
      }
    `,
  ];
  protected store = new StoreController(this);
  private tick = 0;
  @state() private now = Date.now(); // the running agents' durations count up every second
  // the running time of a working agent counts up every second
  override connectedCallback() {
    super.connectedCallback();
    this.tick = window.setInterval(() => {
      this.now = Date.now();
    }, 1000);
  }
  override disconnectedCallback() {
    super.disconnectedCallback();
    clearInterval(this.tick);
  }

  private row = (a: Sub) =>
    html`<relay-subagent-row
      ?running=${a.running}
      .description=${a.description}
      .meta=${[a.agentType, a.model].filter(Boolean).join(" · ")}
      .tool=${a.tool ?? ""}
      .input=${a.input}
      .text=${a.text ?? ""}
      .log=${chat.subLog[a.id]}
      .duration=${a.running ? formatDuration((this.now - Date.parse(a.started_at)) / 1000) : formatDuration((Date.parse(a.last_at) - Date.parse(a.started_at)) / 1000)}
      @toggle=${() => toggleSubLog(a.id)}
    ></relay-subagent-row>`;

  override render() {
    const list = chat.subs[ui.selected] || [],
      run = list.filter(a => a.running),
      done = list.filter(a => !a.running);
    return html`${run.map(this.row)}${done.length ? html`<button class="self-start px-1.5 py-0.5 rounded-md text-xs text-secondary hover:bg-fill hover:text-label" @click=${toggleSubsDone}>${tn("subs.done", done.length)}</button>${chat.subsOpen.has(ui.selected) ? done.map(this.row) : nothing}` : nothing}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-subagents": RelaySubagents;
  }
}
