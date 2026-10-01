import { LitElement, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { t } from "../../core/i18n";
import { emit } from "../../core/dom";
import { tw } from "../../core/styles";
import { todayIso } from "./reminder-calendar";

export type Draft = { open: boolean; text: string; date: string; project: string; repeat: string; err: string; busy: boolean };
declare global { interface HTMLElementEventMap { "reminder-draft": CustomEvent<Partial<Draft>>; "reminder-add": CustomEvent<void> } }

const REPEATS = ["", "1w", "14d", "1m", "3m"];
const FIELD = "border border-separator rounded-lg bg-bg text-label px-2 min-w-0 focus-visible:outline-2 focus-visible:outline-[color-mix(in_srgb,var(--accent)_45%,transparent)]";

/** The new-reminder form. It shows the draft it is given and reports every change; the container keeps the draft (it survives switching views) and does the adding. */
@customElement("relay-reminder-form")
export class ReminderForm extends LitElement {
  static styles = [tw];
  @property({ attribute: false }) draft!: Draft;
  @property({ attribute: false }) projects: { name: string; label: string }[] = [];
  private focusText = false;

  updated() {
    if (this.focusText) { this.focusText = false; this.renderRoot.querySelector<HTMLInputElement>('[data-rem-f="text"]')?.focus(); }
  }

  private patch(p: Partial<Draft>) { emit(this, "reminder-draft", p); }

  private submit() {
    const d = this.draft;
    if (!d.text.trim()) { this.focusText = true; this.requestUpdate(); return; }
    if (!d.date || d.busy) return;
    emit(this, "reminder-add");
  }

  /** Enter in the text field adds, Escape anywhere in the form closes it */
  private onKey = (e: KeyboardEvent) => {
    if (e.isComposing) return;
    const f = (e.target as HTMLElement).dataset.remF;
    if (e.key === "Enter" && f === "text") { e.preventDefault(); this.submit(); }
    else if (e.key === "Escape") this.patch({ open: false, err: "" });
  };

  render() {
    const d = this.draft;
    if (!d.open) return html`<div class="mb-4"><button class="btn" @click=${() => { this.focusText = true; this.patch({ open: true, date: d.date || todayIso(1) }); }}>${t("rem.new")}</button></div>`;
    const set = (f: "text" | "date" | "project" | "repeat") => (e: Event) => this.patch({ [f]: (e.target as HTMLInputElement).value });
    const opt = (v: string, l: string, cur: string) => html`<option value=${v} ?selected=${v === cur}>${l}</option>`;
    return html`<div class="mb-4 flex flex-col gap-2 p-3 border border-separator rounded-xl bg-fill" @keydown=${this.onKey}>
      <input class="${FIELD} h-8 text-lg" data-rem-f="text" .value=${live(d.text)} @input=${set("text")} placeholder=${t("rem.newText")} aria-label=${t("rem.newText")} spellcheck="false">
      <div class="flex flex-wrap items-center gap-2">
        <input type="date" class="${FIELD} h-7 text-sm" data-rem-f="date" .value=${live(d.date)} @change=${set("date")} min=${todayIso()} aria-label=${t("rem.newDate")}>
        <select class="${FIELD} h-7 text-sm" data-rem-f="project" @change=${set("project")} aria-label=${t("rem.newProject")}>
          ${opt("", t("rem.noProject"), d.project)}${this.projects.map(p => opt(p.name, p.label, d.project))}</select>
        <select class="${FIELD} h-7 text-sm" data-rem-f="repeat" @change=${set("repeat")} aria-label=${t("rem.newRepeat")}>
          ${REPEATS.map(r => opt(r, r ? t("rem.every", { n: r }) : t("rem.noRepeat"), d.repeat))}</select>
        <span class="ml-auto flex gap-1.5"><button class="btn" @click=${() => this.patch({ open: false, err: "" })}>${t("rem.cancel")}</button>
          <button class="btn btn-primary disabled:opacity-50" ?disabled=${d.busy} @click=${() => this.submit()}>${t("rem.add")}</button></span></div>
      ${d.err ? html`<div class="text-sm text-[#d33]" role="alert">${d.err}</div>` : nothing}</div>`;
  }
}
