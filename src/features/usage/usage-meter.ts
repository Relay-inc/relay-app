import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { t } from "../../core/i18n";
import { tw } from "../../core/styles";

// the fill follows how close the limit is (the reminders' urgency colours)
const FILL = { "": "bg-secondary", soon: "bg-soon", late: "bg-late" };

/** One limit window: its name (slot), the share used, a thin bar and when it resets. */
@customElement("relay-usage-meter")
export class UsageMeter extends LitElement {
  static styles = [tw, css`:host{display:block}`];
  @property({ type: Number }) pct = 0;
  @property() level: "" | "soon" | "late" = "";
  @property() resets = "";

  render() {
    return html`<div class="pt-2 pb-2.5 border-b border-separator"><div class="flex items-baseline gap-3 text-sm"><span class="flex-1 min-w-0 truncate"><slot></slot></span><span class="tabular-nums">${t("usage.used", { pct: Math.round(this.pct) })}</span></div>
      <div class="h-1 rounded-[2px] bg-fill mt-1.5 mb-1 overflow-hidden"><span class="block h-full rounded-[2px] ${FILL[this.level]}" style=${`width:${Math.min(100, Math.max(0, this.pct))}%`}></span></div><div class="text-sm text-secondary">${this.resets}</div></div>`;
  }
}
