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
  private timerId = 0;
  @state() private now = Date.now(); // the running agents' durations count up every second
  // the running time of a working agent counts up every second
  override connectedCallback() {
    super.connectedCallback();
    this.timerId = window.setInterval(() => {
      this.now = Date.now();
    }, 1000);
  }
  override disconnectedCallback() {
    super.disconnectedCallback();
    clearInterval(this.timerId);
  }

  // a running agent counts up to now, a finished one stopped at its last message
  private durationOf(agent: Sub) {
    const end = agent.running ? this.now : Date.parse(agent.last_at);
    return formatDuration((end - Date.parse(agent.started_at)) / 1000);
  }

  private renderRow = (agent: Sub) =>
    html`<relay-subagent-row
      ?running=${agent.running}
      .description=${agent.description}
      .meta=${[agent.agentType, agent.model].filter(Boolean).join(" · ")}
      .tool=${agent.tool ?? ""}
      .input=${agent.input}
      .text=${agent.text ?? ""}
      .log=${chat.subLog[agent.id]}
      .duration=${this.durationOf(agent)}
      @toggle=${() => toggleSubLog(agent.id)}
    ></relay-subagent-row>`;

  private renderFinished(finished: Sub[]) {
    if (!finished.length) return nothing;
    const unfolded = chat.subsOpen.has(ui.selected);
    return html`<button
        class="self-start px-1.5 py-0.5 rounded-md text-xs text-secondary hover:bg-fill hover:text-label"
        @click=${toggleSubsDone}
      >
        ${tn("subs.done", finished.length)}</button
      >${unfolded ? finished.map(this.renderRow) : nothing}`;
  }

  override render() {
    const agents = chat.subs[ui.selected] || [];
    const running = agents.filter(x => x.running);
    const finished = agents.filter(x => !x.running);
    return html`${running.map(this.renderRow)}${this.renderFinished(finished)}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-subagents": RelaySubagents;
  }
}
