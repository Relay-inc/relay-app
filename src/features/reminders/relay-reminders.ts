import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { t, th, raw, currentLocale } from "../../core/i18n";
import type { Key } from "../../core/locales/en";
import { StoreController } from "../../core/store";
import { tw } from "../../core/styles";
import { reminders, urgency, remAct, remAdd, remChat } from "../../domain/reminders";
import { toast } from "../../domain/navigation";
import { todayIso } from "./reminder-calendar";
import { vault, projectLabel, projectsByLabel } from "../../domain/vault";
import type { Reminder } from "../../domain/reminders";
import type { Draft } from "./reminder-form";
import "./reminder-form";
import "./reminder-row";

const GROUPS: [Key, (days: number) => boolean, string][] = [
  ["rem.late", days => days < 0, "text-late"],
  ["rem.today", days => days === 0, "text-soon"],
  ["rem.tomorrow", days => days === 1, "text-tertiary"],
  ["rem.week", days => days >= 2 && days <= 7, "text-tertiary"],
  ["rem.later", days => days > 7, "text-tertiary"],
];
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);

// the new-reminder form is kept outside the element too, so a half-typed reminder survives switching views
let savedDraft: Draft = { open: false, text: "", date: "", project: "", repeat: "", err: "", busy: false };

const FORM_OPENED = "reminder-form-opened";
/** Opens the new-reminder form (the title bar's button); the draft lives here, outside the element, so the view need not be mounted yet. */
export function openReminderForm() {
  savedDraft = { ...savedDraft, open: true, date: savedDraft.date || todayIso(1) };
  document.dispatchEvent(new Event(FORM_OPENED));
}

/** The reminders view: the new-reminder form, then the reminders grouped by when they are due. */
@customElement("relay-reminders")
export class RelayReminders extends LitElement {
  static override styles = [
    tw,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: 24px;
      }
    `,
  ];
  protected store = new StoreController(this);
  @state() private calendarRow: string | null = null; // the row whose date picker is open
  @state() private busyRow: string | null = null; // the row whose action is running
  @state() private draft: Draft = savedDraft;

  override connectedCallback() {
    super.connectedCallback();
    document.addEventListener(FORM_OPENED, this.onFormOpened);
  }

  override disconnectedCallback() {
    document.removeEventListener(FORM_OPENED, this.onFormOpened);
    super.disconnectedCallback();
  }

  private onFormOpened = () => {
    this.draft = savedDraft;
  };

  private setDraft(changes: Partial<Draft>) {
    this.draft = savedDraft = { ...savedDraft, ...changes };
  }

  private onDraftChange = (e: CustomEvent<Partial<Draft>>) => this.setDraft(e.detail);

  private async addReminder() {
    const draft = this.draft;
    const text = draft.text.trim();
    this.setDraft({ busy: true, err: "" });
    try {
      await remAdd(text, draft.date, draft.project || null, draft.repeat || null);
      this.setDraft({ open: false, text: "", date: "", project: "", repeat: "" });
    } catch (e) {
      this.setDraft({ err: String(e) });
    }
    this.setDraft({ busy: false });
  }

  private async runAction(reminder: Reminder, action: "done" | "push", date?: string) {
    const id = reminder.id;
    this.busyRow = id;
    this.calendarRow = null;
    try {
      await remAct(action, id, date);
    } finally {
      this.busyRow = null;
    }
    const text =
      action === "done"
        ? "rem.toastDone"
        : date === "morgen"
          ? "rem.toastTomorrow"
          : date === "+1w"
            ? "rem.toastWeek"
            : "rem.toastMoved";
    toast(t(text, { text: reminder.title }), () => this.undo(reminder));
  }

  // back to the date it had: a repeating reminder is pushed back, a finished one is written again
  private async undo(reminder: Reminder) {
    const moved = reminders().find(x => x.text === reminder.text && x.date !== reminder.date);
    if (moved) await remAct("push", moved.id, reminder.date);
    else if (!reminders().some(x => x.id === reminder.id))
      await remAdd(reminder.text, reminder.date, null, reminder.repeat);
  }

  private toggleCalendar(id: string) {
    this.calendarRow = this.calendarRow === id ? null : id;
  }

  private renderRow(reminder: Reminder) {
    const id = reminder.id;
    return html`<relay-reminder-row
      .reminder=${reminder}
      .label=${reminder.project ? projectLabel(reminder.project) : ""}
      urgency=${urgency(reminder.days)}
      ?busy=${this.busyRow === id}
      ?cal=${this.calendarRow === id}
      @reminder-chat=${() => remChat(id)}
      @reminder-done=${() => this.runAction(reminder, "done")}
      @reminder-push=${(e: CustomEvent<{ id: string; date: string }>) => this.runAction(reminder, "push", e.detail.date)}
      @reminder-cal=${() => this.toggleCalendar(id)}
    ></relay-reminder-row>`;
  }

  private renderGroup(name: Key, tint: string, dueReminders: Reminder[]) {
    if (!dueReminders.length) return nothing;
    return html`<section>
      <h2
        class="flex items-baseline gap-1.5 pb-2 border-b border-separator text-[11px] font-semibold uppercase tracking-[0.06em] ${tint}"
      >
        ${t(name)} <span class="text-tertiary tabular-nums">${dueReminders.length}</span>
      </h2>
      ${dueReminders.map(reminder => this.renderRow(reminder))}
    </section>`;
  }

  private renderGroups(all: Reminder[]) {
    if (!all.length) return html`<div class="text-secondary text-center py-6">${t("rem.none")}</div>`;
    return GROUPS.map(([name, inGroup, tint]) => {
      const due = all.filter(reminder => inGroup(reminder.days)).sort((a, b) => a.days - b.days);
      return this.renderGroup(name, tint, due);
    });
  }

  // shown when the vault has no reminders file yet
  private renderMissingFile() {
    const vaultInfo = vault.snap.vault;
    if (vaultInfo?.found?.reminders !== false) return nothing;
    const path = raw(`<code class="font-mono">${escapeHtml(vaultInfo.map?.reminders ?? "")}</code>`);
    return html`<div class="text-secondary mb-2.5">${th("rem.noFile", { path })}</div>`;
  }

  override render() {
    return html`<relay-reminder-form
        .draft=${this.draft}
        .projects=${projectsByLabel(currentLocale())}
        @reminder-draft=${this.onDraftChange}
        @reminder-add=${() => this.addReminder()}
      ></relay-reminder-form>
      ${this.renderMissingFile()} ${this.renderGroups(reminders())}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-reminders": RelayReminders;
  }
}
