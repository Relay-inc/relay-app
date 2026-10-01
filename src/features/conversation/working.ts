import { LitElement, html, css, nothing } from "lit";
import { ifDefined } from "lit/directives/if-defined.js";
import { customElement, property } from "lit/decorators.js";
import { tw } from "../../core/styles";
import { t } from "../../core/i18n";

/** The agent is busy: the done line's divider with a spinner and what it is doing, so the turn ends where it ran. `label` is read out by assistive technology. */
@customElement("relay-working")
export class Working extends LitElement {
  static override styles = [
    tw,
    css`
      :host {
        display: block;
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
      <span class="flex-1 h-px bg-separator"></span><span class="spinner"></span
      ><span class="max-w-[70%] min-w-0 truncate [&_code]:font-mono [&_code]:text-[11px]"
        >${this.text || t("bar.working")}</span
      ><span class="flex-1 h-px bg-separator"></span>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-working": Working;
  }
}
