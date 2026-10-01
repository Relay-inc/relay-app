import { LitElement, html, nothing } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { t } from "../../core/i18n";
import { emit } from "../../core/dom";
import { tw } from "../../core/styles";
import { icon } from "../../core/icons";
import { todayIso } from "./reminder-calendar";
import { projectTint } from "./reminder-row";

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
// a pill: the control inside is bare, the icons sit on top of it
const PILL =
  "relative inline-flex items-center h-7 rounded-[7px] bg-fill-2 text-xs focus-within:outline-2 focus-within:outline-accent/45";
const BARE = "h-7 bg-transparent border-0 outline-0 text-xs cursor-pointer min-w-0";
const SELECT = `${BARE} appearance-none pl-7 pr-6`;
const PILL_ICON = "glyph absolute left-2.5 size-3.25 pointer-events-none";
const CHEVRON = "glyph absolute right-2 size-2.75 text-tertiary pointer-events-none [stroke-width:2]";

type DraftField = "text" | "date" | "project" | "repeat";

/** The new-reminder form. It shows the draft it is given and reports every change; the container keeps the draft (it survives switching views) and does the adding. */
@customElement("relay-reminder-form")
export class ReminderForm extends LitElement {
  static override styles = [tw];
  @property({ attribute: false }) draft!: Draft;
  @property({ attribute: false }) projects: { name: string; label: string }[] = [];
  @query('[data-rem-f="text"]') private textField?: HTMLInputElement;

  override updated(changed: Map<string, Draft | undefined>) {
    // the form was opened (from the title bar's button): focus the text field once it is drawn
    if (this.draft.open && !changed.get("draft")?.open) this.textField?.focus();
  }

  private patch(changes: Partial<Draft>) {
    emit(this, "reminder-draft", changes);
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

  private renderFilters(draft: Draft) {
    return html`<div class="flex flex-wrap items-center gap-2">
      <label class=${PILL}>
        ${icon("cal", `${PILL_ICON} text-secondary`)}
        <input
          type="date"
          class="${BARE} pl-7 pr-2.5"
          data-rem-f="date"
          .value=${live(draft.date)}
          @change=${this.onField("date")}
          min=${todayIso()}
          aria-label=${t("rem.newDate")}
        />
      </label>
      <label class=${PILL}>
        ${icon("folder", `${PILL_ICON} ${projectTint(draft.project)}`)}
        <select
          class=${SELECT}
          data-rem-f="project"
          @change=${this.onField("project")}
          aria-label=${t("rem.newProject")}
        >
          ${this.renderOption("", t("rem.noProject"), draft.project)}${this.projects.map(project => this.renderOption(project.name, project.label, draft.project))}
        </select>
        ${icon("chevron", CHEVRON)}
      </label>
      <label class="${PILL} ${draft.repeat ? "" : "text-secondary"}">
        ${icon("refresh", `${PILL_ICON} text-secondary`)}
        <select class=${SELECT} data-rem-f="repeat" @change=${this.onField("repeat")} aria-label=${t("rem.newRepeat")}>
          ${REPEATS.map(repeat => this.renderOption(repeat, repeat ? t("rem.every", { n: repeat }) : t("rem.noRepeat"), draft.repeat))}
        </select>
        ${icon("chevron", CHEVRON)}
      </label>
      <span class="ml-auto flex gap-2"
        ><button class="btn h-7.5 px-3 rounded-lg text-[13px] cursor-pointer" @click=${() => this.close()}>
          ${t("rem.cancel")}
        </button>
        <button
          class="btn btn-primary h-7.5 px-3 rounded-lg text-[13px] cursor-pointer disabled:opacity-50"
          ?disabled=${draft.busy}
          @click=${() => this.submit()}
        >
          ${t("rem.add")}
        </button></span
      >
    </div>`;
  }

  override render() {
    const draft = this.draft;
    if (!draft.open) return nothing;
    return html`<div
      class="flex flex-col gap-2.5 p-3.5 border border-separator-strong rounded-xl bg-raised shadow-md"
      @keydown=${this.onKey}
    >
      <input
        class="h-8.5 px-0.5 border-0 outline-0 bg-transparent text-[15px] text-label placeholder:text-tertiary"
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
