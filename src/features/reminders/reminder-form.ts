import { LitElement, html, nothing } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { t } from "../../core/i18n";
import { emit } from "../../core/dom";
import { tw } from "../../core/styles";
import { todayIso } from "./reminder-calendar";

export type Draft = {
  open: boolean;
  text: string;
  date: string;
  project: string;
  repeat: string;
  err: string;
  busy: boolean;
};
declare global {
  interface HTMLElementEventMap {
    "reminder-draft": CustomEvent<Partial<Draft>>;
    "reminder-add": CustomEvent<void>;
  }
}

const REPEATS = ["", "1w", "14d", "1m", "3m"];
const FIELD =
  "border border-separator rounded-lg bg-bg text-label px-2 min-w-0 focus-visible:outline-2 focus-visible:outline-accent/45";

type DraftField = "text" | "date" | "project" | "repeat";

/** The new-reminder form. It shows the draft it is given and reports every change; the container keeps the draft (it survives switching views) and does the adding. */
@customElement("relay-reminder-form")
export class ReminderForm extends LitElement {
  static override styles = [tw];
  @property({ attribute: false }) draft!: Draft;
  @property({ attribute: false }) projects: { name: string; label: string }[] = [];
  @query('[data-rem-f="text"]') private textField?: HTMLInputElement;
  private focusText = false; // opening the form: focus the text field once it is drawn

  override updated() {
    if (this.focusText) {
      this.focusText = false;
      this.textField?.focus();
    }
  }

  private patch(changes: Partial<Draft>) {
    emit(this, "reminder-draft", changes);
  }

  private open() {
    this.focusText = true;
    this.patch({ open: true, date: this.draft.date || todayIso(1) });
  }

  private close() {
    this.patch({ open: false, err: "" });
  }

  private submit() {
    const draft = this.draft;
    if (!draft.text.trim()) {
      this.textField?.focus();
      return;
    }
    if (!draft.date || draft.busy) return;
    emit(this, "reminder-add");
  }

  /** Enter in the text field adds, Escape anywhere in the form closes it */
  private onKey = (e: KeyboardEvent) => {
    if (e.isComposing) return;
    const field = (e.target as HTMLElement).dataset.remF;
    if (e.key === "Enter" && field === "text") {
      e.preventDefault();
      this.submit();
    } else if (e.key === "Escape") {
      this.close();
    }
  };

  private onField(field: DraftField) {
    return (e: Event) => this.patch({ [field]: (e.target as HTMLInputElement).value });
  }

  private renderOption(value: string, label: string, current: string) {
    return html`<option value=${value} ?selected=${value === current}>${label}</option>`;
  }

  private renderClosed() {
    return html`<div class="mb-4">
      <button class="btn" @click=${() => this.open()}>${t("rem.new")}</button>
    </div>`;
  }

  private renderFilters(draft: Draft) {
    return html`<div class="flex flex-wrap items-center gap-2">
      <input
        type="date"
        class="${FIELD} h-7 text-sm"
        data-rem-f="date"
        .value=${live(draft.date)}
        @change=${this.onField("date")}
        min=${todayIso()}
        aria-label=${t("rem.newDate")}
      />
      <select
        class="${FIELD} h-7 text-sm"
        data-rem-f="project"
        @change=${this.onField("project")}
        aria-label=${t("rem.newProject")}
      >
        ${this.renderOption("", t("rem.noProject"), draft.project)}${this.projects.map(project => this.renderOption(project.name, project.label, draft.project))}
      </select>
      <select
        class="${FIELD} h-7 text-sm"
        data-rem-f="repeat"
        @change=${this.onField("repeat")}
        aria-label=${t("rem.newRepeat")}
      >
        ${REPEATS.map(repeat => this.renderOption(repeat, repeat ? t("rem.every", { n: repeat }) : t("rem.noRepeat"), draft.repeat))}
      </select>
      <span class="ml-auto flex gap-1.5"
        ><button class="btn" @click=${() => this.close()}>${t("rem.cancel")}</button>
        <button class="btn btn-primary disabled:opacity-50" ?disabled=${draft.busy} @click=${() => this.submit()}>
          ${t("rem.add")}
        </button></span
      >
    </div>`;
  }

  override render() {
    const draft = this.draft;
    if (!draft.open) return this.renderClosed();
    return html`<div
      class="mb-4 flex flex-col gap-2 p-3 border border-separator rounded-xl bg-fill"
      @keydown=${this.onKey}
    >
      <input
        class="${FIELD} h-8 text-base"
        data-rem-f="text"
        .value=${live(draft.text)}
        @input=${this.onField("text")}
        placeholder=${t("rem.newText")}
        aria-label=${t("rem.newText")}
        spellcheck="false"
      />
      ${this.renderFilters(draft)}
      ${draft.err ? html`<div class="text-sm text-late" role="alert">${draft.err}</div>` : nothing}
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-reminder-form": ReminderForm;
  }
}
