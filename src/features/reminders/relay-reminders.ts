import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { t, th, raw, currentLocale } from "../../core/i18n";
import type { Key } from "../../core/locales/en";
import { StoreController } from "../../core/store";
import { tw } from "../../core/styles";
import { reminders, urgency, remAct, remAdd, remChat } from "../../domain/reminders";
import { vault, pLabel, projectsByLabel } from "../../domain/vault";
import type { Reminder } from "../../domain/reminders";
import type { Draft } from "./reminder-form";
import "./reminder-form";
import "./reminder-row";

const GROUPS: [Key, (d: number) => boolean][] = [
  ["rem.late", d => d < 0],
  ["rem.today", d => d === 0],
  ["rem.tomorrow", d => d === 1],
  ["rem.week", d => d >= 2 && d <= 7],
  ["rem.later", d => d > 7],
];
const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

// the new-reminder form is kept outside the element too, so a half-typed reminder survives switching views
let saved: Draft = { open: false, text: "", date: "", project: "", repeat: "", err: "", busy: false };

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
  @state() private cal: string | null = null; // the row whose date picker is open
  @state() private busy: string | null = null; // the row whose action is running
  @state() private draft: Draft = saved;
  private setDraft(p: Partial<Draft>) {
    this.draft = saved = { ...saved, ...p };
  }

  private patch = (e: CustomEvent<Partial<Draft>>) => this.setDraft(e.detail);

  private async add() {
    const d = this.draft,
      text = d.text.trim();
    this.setDraft({ busy: true, err: "" });
    try {
      await remAdd(text, d.date, d.project || null, d.repeat || null);
      this.setDraft({ open: false, text: "", date: "", project: "", repeat: "" });
    } catch (e) {
      this.setDraft({ err: String(e) });
    }
    this.setDraft({ busy: false });
  }

  private async run(id: string, action: "done" | "push", date?: string) {
    this.busy = id;
    this.cal = null;
    try {
      await remAct(action, id, date);
    } finally {
      this.busy = null;
    }
  }

  private row(r: Reminder) {
    return html`<relay-reminder-row
      .reminder=${r}
      .label=${r.project ? pLabel(r.project) : ""}
      urgency=${urgency(r.days)}
      ?busy=${this.busy === r.id}
      ?cal=${this.cal === r.id}
      @reminder-chat=${() => remChat(r.id)}
      @reminder-done=${() => this.run(r.id, "done")}
      @reminder-push=${(e: CustomEvent<{ id: string; date: string }>) => this.run(e.detail.id, "push", e.detail.date)}
      @reminder-cal=${() => {
        this.cal = this.cal === r.id ? null : r.id;
      }}
    ></relay-reminder-row>`;
  }

  override render() {
    const all = reminders();
    const groups = GROUPS.map(([name, f]) => {
      const items = all.filter(r => f(r.days)).sort((a, b) => a.days - b.days);
      return items.length
        ? html`<section class="mb-6">
            <h2 class="list-head">${t(name)} <span class="font-mono tabular-nums">${items.length}</span></h2>
            ${items.map(r => this.row(r))}
          </section>`
        : nothing;
    });
    return html`<relay-reminder-form
        .draft=${this.draft}
        .projects=${projectsByLabel(currentLocale())}
        @reminder-draft=${this.patch}
        @reminder-add=${() => this.add()}
      ></relay-reminder-form>
      ${vault.snap.vault?.found?.reminders === false ? html`<div class="text-secondary mb-2.5">${th("rem.noFile", { path: raw(`<code class="font-mono">${esc(vault.snap.vault?.map?.reminders ?? "")}</code>`) })}</div>` : nothing}
      ${all.length ? groups : html`<div class="text-secondary text-center py-6">${t("rem.none")}</div>`}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-reminders": RelayReminders;
  }
}
