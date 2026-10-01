import { html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { emit } from "../../core/dom";
import { at, ath, t } from "../../core/i18n";
import type { AgentProvider, AgentStatus } from "../../domain/agents";
import { btn, field, FIELD, HINT0, nc, PILL, SELECT, val } from "./blocks";
import { SettingsElement } from "./settings-element";
import { tws } from "./styles";

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
  static styles = [tws];

  @property({ attribute: false }) status!: AgentStatus;
  @property({ attribute: false }) cfg!: { on: boolean; bin: string; [opt: string]: unknown };
  /** The agent's own package: its help and options */
  @property({ attribute: false }) agent?: AgentProvider;

  render() {
    const { status: p, cfg, agent: ap } = this,
      d = p.detect,
      id = p.id;
    const caps = (["images", "permissions", "questions", "subagents", "terminal", "limits", "effort"] as const)
      .filter(c => p.caps[c])
      .map(c => html`<span class=${PILL}>${t(`ag.cap.${c}`)}</span>`);
    return html`${ap ? html`<p class=${HINT0}>${ath(ap, "set.help")}</p>` : nothing}
      ${field(
        nc(t("ag.bin")),
        html`<input
          class=${FIELD}
          id="agbin-${id}"
          .value=${live(cfg.bin)}
          placeholder=${t("ag.binPh", { bin: p.defaultBin })}
          spellcheck="false"
          @change=${(e: Event) => emit(this, "agent-bin", val(e).trim())}
        />`,
        { id: `agbin-${id}`, hint: d.note ? html`<code>${d.note}</code>` : "" },
      )}
      ${(ap?.options ?? []).map(o =>
        field(
          at(ap!, o.label),
          html`<select
            class=${SELECT}
            id="agopt-${id}-${o.id}"
            @change=${(e: Event) => emit(this, "agent-option", { id: o.id, value: val(e) })}
          >
            ${o.choices.map(
              c =>
                html`<option value=${c.id} ?selected=${(cfg[o.id] ?? o.choices[0].id) === c.id}>
                  ${at(ap!, c.label)}
                </option>`,
            )}
          </select>`,
          { id: `agopt-${id}-${o.id}` },
        ),
      )}
      ${field(nc(t("ag.caps")), html`<span class="flex max-w-2xs flex-wrap justify-end gap-1">${caps}</span>`)}
      <div class="mt-0.5 flex flex-wrap items-center gap-2">
        <span class="flex-1"></span
        ><button class=${btn("ghost")} @click=${() => emit(this, "agent-remove")}>${t("ag.remove")}</button>
      </div>`;
  }
}
