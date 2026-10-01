import { html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { emit } from "../../core/dom";
import { t, th } from "../../core/i18n";
import { buttonClass, field, FIELD, footer, FOOTER_IN_ROW, HINT_IN_ROW, inputValue, withoutColon } from "./blocks";
import { SettingsElement } from "./settings-element";
import { tws } from "./styles";
import type { CalendarCfg } from "./types";

declare global {
  interface HTMLElementTagNameMap {
    "relay-settings-calendar": SettingsCalendar;
  }
  interface HTMLElementEventMap {
    "cal-connect": CustomEvent<{ email: string; url: string }>;
    "cal-drop": CustomEvent<string>;
  }
}

const SUB = "mt-2 grid gap-0.5 border-t border-s-border pt-3";

/** Calendar's body in the integrations list: the calendars read, and the fields to add one by its secret iCal address.
 *  The address goes straight to the keychain (calendar_connect), the settings only keep the email. */
@customElement("relay-settings-calendar")
export class SettingsCalendar extends SettingsElement {
  static override styles = [tws];

  @property({ attribute: false }) config!: CalendarCfg;
  @property({ type: Boolean }) busy = false;
  @property() message = "";
  @property({ type: Boolean }) ok = false;
  @state() private email = "";
  @state() private url = "";

  override updated(changed: Map<string, unknown>) {
    // a calendar that was added clears the fields; a failed one keeps them to fix
    if (changed.has("ok") && this.ok && !this.busy) this.email = this.url = "";
  }

  private renderFeeds() {
    if (!this.config.feeds.length) return nothing;
    return html`<div class="rounded-md border border-s-border px-3">
      ${this.config.feeds.map(
        feed =>
          html`<div class="group flex items-center gap-3 border-t border-s-border py-2.5 first:border-t-0">
            <b class="min-w-0 flex-1 truncate font-medium">${feed.email}</b>
            <button
              class="${buttonClass("ghost")} opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
              @click=${() => emit(this, "cal-drop", feed.email)}
            >
              ${t("mail.remove")}
            </button>
          </div>`,
      )}
    </div>`;
  }

  override render() {
    const email = html`<input
      class=${FIELD}
      id="calemail"
      type="email"
      .value=${live(this.email)}
      @input=${(e: Event) => (this.email = inputValue(e))}
      placeholder="naam@bedrijf.be"
      spellcheck="false"
      autocomplete="off"
    />`;
    const url = html`<input
      class=${FIELD}
      id="calurl"
      type="password"
      .value=${live(this.url)}
      @input=${(e: Event) => (this.url = inputValue(e))}
      placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
      spellcheck="false"
      autocomplete="off"
    />`;
    const connect = html`<button
      class=${buttonClass("primary")}
      ?disabled=${this.busy || !this.email.trim() || !this.url.trim()}
      @click=${() => emit(this, "cal-connect", { email: this.email.trim(), url: this.url.trim() })}
    >
      ${this.busy ? html`<span class="spinner"></span>` : nothing}${t("cal.connect")}
    </button>`;
    return html`<p class=${HINT_IN_ROW}>${th("cal.help")}</p>
      ${this.renderFeeds()}
      <div class=${SUB}><b class="text-xs font-semibold">${t("cal.addH")}</b></div>
      <p class=${HINT_IN_ROW}>${th("cal.steps")}</p>
      ${field(withoutColon(t("cal.emailL")), email, { id: "calemail", classes: "w-full" })}
      ${field(withoutColon(t("cal.urlL")), url, { id: "calurl", classes: "w-full" })}
      <div class=${FOOTER_IN_ROW}>
        <button class=${buttonClass("ghost")} @click=${() => emit(this, "int-remove")}>${t("ag.remove")}</button
        >${footer(this.message, this.ok, connect)}
      </div>`;
  }
}
