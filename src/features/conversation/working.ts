import { LitElement, html, css, nothing } from "lit";
import { ifDefined } from "lit/directives/if-defined.js";
import { customElement, property } from "lit/decorators.js";
import { tw } from "../../core/styles";
import { t } from "../../core/i18n";

/** The agent is busy: the done line's divider with an accent band flowing along it towards what it is doing, so the turn ends where it ran. `label` is read out by assistive technology. */
@customElement("relay-working")
export class Working extends LitElement {
  static override styles = [
    tw,
    css`
      :host {
        display: block;
      }
      /* an accent band runs along each line towards the label, the left one rightwards, the right one leftwards */
      .flow {
        background: linear-gradient(90deg, var(--separator) 0 35%, var(--accent) 50%, var(--separator) 65% 100%)
          var(--separator);
        background-size: 300% 100%;
        animation: flow 1.6s ease-in-out infinite;
      }
      .flow.rev {
        animation-direction: reverse;
      }
      @keyframes flow {
        from {
          background-position: 100% 0;
        }
        to {
          background-position: 0 0;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .flow {
          background: var(--separator);
        }
      }
    `,
  ];
  @property() text = "";
  @property() label = "";

  override render() {
    return html`<div
      class="flex items-center gap-2.5 text-tertiary text-xs"
      role=${ifDefined(this.label ? "status" : undefined)}
      aria-label=${this.label || nothing}
    >
      <span class="flow flex-1 h-px"></span
      ><span class="max-w-[70%] min-w-0 truncate [&_code]:font-mono [&_code]:text-[11px]"
        >${this.text || t("bar.working")}</span
      ><span class="flow rev flex-1 h-px"></span>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-working": Working;
  }
}
