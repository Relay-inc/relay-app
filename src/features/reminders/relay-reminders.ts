import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { t, th, raw, currentLocale } from "../../core/i18n";
import type { Key } from "../../core/locales/en";
import { StoreController } from "../../core/store";
import { tw } from "../../core/styles";
import { reminders, urgency, remAct, remAdd, remChat } from "../../domain/reminders";
import { vault, projectLabel, projectsByLabel } from "../../domain/vault";
import type { Reminder } from "../../domain/reminders";
import type { Draft } from "./reminder-form";
import "./reminder-form";
import "./reminder-row";

const GROUPS: [Key, (days: number) => boolean][] = [
  ["rem.late", days => days < 0],
  ["rem.today", days => days === 0],
  ["rem.tomorrow", days => days === 1],
  ["rem.week", days => days >= 2 && days <= 7],
  ["rem.later", days => days > 7],
];
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);

// the new-reminder form is kept outside the element too, so a half-typed reminder survives switching views
let savedDraft: Draft = { open: false, text: "", date: "", project: "", repeat: "", err: "", busy: false };

/** The reminders view: the new-reminder form, then the reminders grouped by when they are due. */
@customElement("relay-reminders")
export class RelayReminders extends LitElement {
  static override styles = [
    tw,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: 18px;
      }
    `,
  ];
  protected store = new StoreController(this);
  @state() private calendarRow: string | null = null; // the row whose date picker is open
  @state() private busyRow: string | null = null; // the row whose action is running
  @state() private draft: Draft = savedDraft;

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

  private async runAction(id: string, action: "done" | "push", date?: string) {
    this.busyRow = id;
    this.calendarRow = null;
    try {
      await remAct(action, id, date);
    } finally {
      this.busyRow = null;
    }
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
      @reminder-done=${() => this.runAction(id, "done")}
      @reminder-push=${(e: CustomEvent<{ id: string; date: string }>) => this.runAction(e.detail.id, "push", e.detail.date)}
      @reminder-cal=${() => this.toggleCalendar(id)}
    ></relay-reminder-row>`;
  }

  private renderGroup(name: Key, dueReminders: Reminder[]) {
    if (!dueReminders.length) return nothing;
    return html`<section class="mb-6">
      <h2 class="list-head">${t(name)} <span class="font-mono tabular-nums">${dueReminders.length}</span></h2>
      ${dueReminders.map(reminder => this.renderRow(reminder))}
    </section>`;
  }

  private renderGroups(all: Reminder[]) {
    if (!all.length) return html`<div class="text-secondary text-center py-6">${t("rem.none")}</div>`;
    return GROUPS.map(([name, inGroup]) => {
      const due = all.filter(reminder => inGroup(reminder.days)).sort((a, b) => a.days - b.days);
      return this.renderGroup(name, due);
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
