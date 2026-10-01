import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { t, th } from "../../core/i18n";
import { emit } from "../../core/dom";
import { tw } from "../../core/styles";
import type { MailFilter } from "../../domain/mail";

declare global {
  interface HTMLElementEventMap {
    filter: CustomEvent<Partial<MailFilter>>;
    reload: CustomEvent<void>;
  }
}

/** The inbox's filter bar: search, read state, project, reload. */
const STATE_LABELS = { all: "mail.fAll", unread: "mail.fUnread", read: "mail.fRead" } as const;

@customElement("relay-mail-bar")
export class MailBar extends LitElement {
  static override styles = [
    tw,
    css`
      :host {
        display: block;
      }
    `,
  ];
  @property({ attribute: false }) filter!: MailFilter;
  /** the projects to pick from: [name, display label] */
  @property({ attribute: false }) projects: [string, string][] = [];
  @property({ type: Boolean }) busy = false;

  private setFilter(change: Partial<MailFilter>) {
    emit(this, "filter", change);
  }

  private renderStateButtons() {
    const states = ["all", "unread", "read"] as const;
    return html`<span class="seg"
      >${states.map(
        state =>
          html`<button class=${this.filter.state === state ? "on" : ""} @click=${() => this.setFilter({ state })}>
            ${th(STATE_LABELS[state])}
          </button>`,
      )}</span
    >`;
  }
  private renderProjectSelect() {
    const selected = this.filter.project;
    return html`<select
      class="field"
      @change=${(e: Event) => this.setFilter({ project: (e.target as HTMLSelectElement).value })}
    >
      <option value="" .selected=${!selected}>${t("mail.allProjects")}</option>
      <option value="-" .selected=${selected === "-"}>${t("mail.noProject")}</option>
      ${this.projects.map(([name, label]) => html`<option value=${name} .selected=${selected === name}>${label}</option>`)}
    </select>`;
  }

  override render() {
    // the search field stays one element across redraws, so it keeps its focus and caret while the list changes
    return html`<div class="flex flex-wrap items-center gap-2 mb-3.5">
      <input
        class="field w-50 placeholder:text-secondary"
        type="search"
        placeholder=${t("mail.search")}
        .value=${this.filter.q}
        spellcheck="false"
        @input=${(e: Event) => this.setFilter({ q: (e.target as HTMLInputElement).value })}
      />
      ${this.renderStateButtons()}${this.renderProjectSelect()}
      <span class="flex-1"></span>${this.busy ? html`<span class="spinner"></span>` : nothing}<button
        class="btn"
        @click=${() => emit(this, "reload")}
      >
        ${th("pr.reload")}
      </button>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-mail-bar": MailBar;
  }
}
