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
@customElement("relay-mail-bar")
export class MailBar extends LitElement {
  static styles = [
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

  render() {
    const f = this.filter,
      set = (p: Partial<MailFilter>) => emit(this, "filter", p);
    // the search field stays one element across redraws, so it keeps its focus and caret while the list changes
    return html`<div class="flex flex-wrap items-center gap-2 mb-3.5">
      <input
        class="field w-50 placeholder:text-secondary"
        type="search"
        placeholder=${t("mail.search")}
        .value=${f.q}
        spellcheck="false"
        @input=${(e: Event) => set({ q: (e.target as HTMLInputElement).value })}
      />
      <span class="seg"
        >${(["all", "unread", "read"] as const).map(
          s =>
            html`<button class=${f.state === s ? "on" : ""} @click=${() => set({ state: s })}>
              ${th(s === "all" ? "mail.fAll" : s === "unread" ? "mail.fUnread" : "mail.fRead")}
            </button>`,
        )}</span
      >
      <select class="field" @change=${(e: Event) => set({ project: (e.target as HTMLSelectElement).value })}>
        <option value="" .selected=${!f.project}>${t("mail.allProjects")}</option>
        <option value="-" .selected=${f.project === "-"}>${t("mail.noProject")}</option>
        ${this.projects.map(([p, label]) => html`<option value=${p} .selected=${f.project === p}>${label}</option>`)}
      </select>
      <span class="flex-1"></span>${this.busy ? html`<span class="spinner"></span>` : nothing}<button
        class="btn"
        @click=${() => emit(this, "reload")}
      >
        ${th("pr.reload")}
      </button>
    </div>`;
  }
}
