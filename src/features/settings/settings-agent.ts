import { html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { emit } from "../../core/dom";
import { at, ath, t } from "../../core/i18n";
import type { AgentProvider, AgentStatus } from "../../domain/agents";
import { field, FIELD, HINT_IN_ROW, withoutColon, PILL, removeFooter, SELECT, inputValue } from "./blocks";
import { SettingsElement } from "./settings-element";
import { contents, tws } from "./styles";

declare global {
  interface HTMLElementTagNameMap {
    "relay-settings-agent": SettingsAgent;
  }
  interface HTMLElementEventMap {
    "agent-bin": CustomEvent<string>;
    "agent-option": CustomEvent<{ id: string; value: string }>;
    "agent-remove": CustomEvent<void>;
  }
}

/** One coding agent's settings, in its folded-open row: help, the program, its options and what it can do. */
@customElement("relay-settings-agent")
export class SettingsAgent extends SettingsElement {
  // its parts are rows of the folded-open row's grid, so they get its gap
  static override styles = [tws, contents];

  @property({ attribute: false }) status!: AgentStatus;
  @property({ attribute: false }) config!: { on: boolean; bin: string; [opt: string]: unknown };
  /** The agent's own package: its help and options */
  @property({ attribute: false }) agent?: AgentProvider;

  private renderCapabilities() {
    const names = ["images", "permissions", "questions", "subagents", "terminal", "limits", "effort"] as const;
    const pills = names
      .filter(name => this.status.caps[name])
      .map(name => html`<span class=${PILL}>${t(`ag.cap.${name}`)}</span>`);
    // the label above the pills: a row of them on the right would wrap into a ragged column
    return html`<div class="grid gap-1.5">
      <span class="text-[13px] text-s-fg">${withoutColon(t("ag.caps"))}</span>
      <div class="flex flex-wrap gap-1">${pills}</div>
    </div>`;
  }

  private renderBin() {
    const { status, config } = this;
    const id = status.id;
    const note = status.detect.note;
    const input = html`<input
      class=${FIELD}
      id="agbin-${id}"
      .value=${live(config.bin)}
      placeholder=${t("ag.binPh", { bin: status.defaultBin })}
      spellcheck="false"
      @change=${(e: Event) => emit(this, "agent-bin", inputValue(e).trim())}
    />`;
    return field(withoutColon(t("ag.bin")), input, {
      id: `agbin-${id}`,
      hint: note ? html`<span class="block truncate font-mono" title=${note}>${note}</span>` : "",
    });
  }

  private renderOption(provider: AgentProvider, option: NonNullable<AgentProvider["options"]>[number]) {
    const id = `agopt-${this.status.id}-${option.id}`;
    const current = this.config[option.id] ?? option.choices[0].id;
    const choices = option.choices.map(
      choice =>
        html`<option value=${choice.id} ?selected=${current === choice.id}>${at(provider, choice.label)}</option>`,
    );
    const select = html`<select
      class=${SELECT}
      id=${id}
      @change=${(e: Event) => emit(this, "agent-option", { id: option.id, value: inputValue(e) })}
    >
      ${choices}
    </select>`;
    return field(at(provider, option.label), select, { id });
  }

  override render() {
    const provider = this.agent;
    return html`${provider ? html`<p class=${HINT_IN_ROW}>${ath(provider, "set.help")}</p>` : nothing}
    ${this.renderBin()} ${(provider?.options ?? []).map(option => this.renderOption(provider!, option))}
    ${this.renderCapabilities()} ${removeFooter(() => emit(this, "agent-remove"))}`;
  }
}
