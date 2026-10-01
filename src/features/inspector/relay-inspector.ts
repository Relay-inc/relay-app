import { LitElement, css, html, nothing } from "lit";
import { customElement } from "lit/decorators.js";
import { t, th } from "../../core/i18n";
import { md } from "../../core/markdown";
import { StoreController } from "../../core/store";
import { tw } from "../../core/styles";
import { mdDefaults } from "../../components/md-defaults";
import { ui } from "../../domain/ui";
import { ghOn } from "../../domain/config";
import { project, projectLabel } from "../../domain/vault";
import { selectedProject } from "../../domain/chats/state";
import { panel, setTab, cardOf, closeDetail, openDetail, cardAct, type CardAct } from "../../domain/panel";
import { prs, type PR } from "../../domain/prs";
import { panelItem, prKey } from "../../domain/keys";
import { reminders, urgency, type Reminder } from "../../domain/reminders";
import "./todo-list";
import "../pull-requests/pr-row";
import "../pull-requests/relay-pr-detail";
import "../mail/relay-mail-detail";
import "../notes/relay-note-detail";

type ProjectInfo = NonNullable<ReturnType<typeof project>>;

const TABS = [
  ["open", "tab.open"],
  ["stand", "tab.stand"],
  ["rem", "nav.reminders"],
  ["prs", "tab.prs"],
] as const;

/** The right panel: the tabs, the "today" list, a project's tabs, and the open PR, mail, note or card. */
@customElement("relay-inspector")
export class RelayInspector extends LitElement {
  // the border sits on an inner wrapper: the grid's `* { border: 0 }` reset (outer context) would beat one on the host
  static override styles = [
    tw,
    mdDefaults,
    css`
      :host {
        display: flex;
        flex-direction: column;
        min-height: 0;
        background: var(--bg);
      }
    `,
  ];
  protected store = new StoreController(this);

  protected override willUpdate() {
    this.toggleAttribute("wide", !!panel.open);
    if (ui.tab === "prs" && !ghOn()) ui.tab = "open";
  }

  private renderDetail() {
    const key = panel.open;
    switch (panelItem(key)?.kind) {
      case "card": {
        // the card's markup comes from its provider package, which tells the panel through an event that its close button was clicked
        const card = cardOf(key);
        return card
          ? html`<div
              .inert=${panel.acting}
              class=${panel.acting ? "opacity-70" : ""}
              @detail-close=${closeDetail}
              @detail-act=${(e: CustomEvent<CardAct>) => cardAct(key, e.detail)}
            >
              ${panel.actErr ? html`<div class="err-box mb-3">${panel.actErr}</div>` : nothing}${card.detail.render(panel.detail[key] ?? null, panel.err)}
            </div>`
          : nothing;
      }
      case "note":
        return html`<relay-note-detail></relay-note-detail>`;
      case "mail":
        return html`<relay-mail-detail></relay-mail-detail>`;
      default:
        return html`<relay-pr-detail></relay-pr-detail>`;
    }
  }

  private renderHeading(title: unknown, meta?: unknown) {
    return html`<div class="flex items-baseline gap-1.5 mb-2.5">
      <h2 class="text-[13px] font-semibold">${title}</h2>
      ${meta === undefined ? nothing : html`<span class="text-xs text-tertiary tabular-nums">${meta}</span>`}
    </div>`;
  }
  private renderNote(text: unknown) {
    return html`<div class="text-[13px] text-secondary mb-3">${text}</div>`;
  }

  private renderPrRow(pr: PR, mine: boolean) {
    const key = prKey(pr.repo, pr.number);
    return html`<relay-pr-row
      compact
      .pr=${pr}
      ?mine=${mine}
      .project=${pr.project ? projectLabel(pr.project) : ""}
      ?selected=${panel.open === key}
      @open-pr=${() => openDetail(key)}
    ></relay-pr-row>`;
  }

  private dueLabel(reminder: Reminder) {
    if (reminder.days < 0) return th("due.overdue", { n: -reminder.days });
    if (reminder.days === 0) return th("due.today");
    return th("due.in", { n: reminder.days });
  }

  // no project selected: what is due today or overdue, across all projects
  private renderToday() {
    const due = reminders().filter(reminder => reminder.days <= 0);
    const items = due.map(reminder => ({
      text: reminder.title,
      project: reminder.project || "",
      due: urgency(reminder.days),
      when: this.dueLabel(reminder),
    }));
    return html`${this.renderHeading(th("insp.today"), due.length)}${
      due.length ? html`<relay-todo-list .items=${items}></relay-todo-list>` : this.renderNote(th("insp.nothingDue"))
    }`;
  }

  private renderProjectPrs(projectName: string) {
    if (!prs.list) return this.renderNote(th("pr.loading"));
    const review = prs.list.review.filter(pr => pr.project === projectName);
    const mine = prs.list.mine.filter(pr => pr.project === projectName);
    const count = review.length + mine.length;
    return html`${this.renderHeading(th("nav.prs"), count)}${
      count
        ? html`<div>${review.map(pr => this.renderPrRow(pr, false))}${mine.map(pr => this.renderPrRow(pr, true))}</div>`
        : this.renderNote(th("pr.noneProject"))
    }`;
  }

  private renderStand(info: ProjectInfo) {
    return html`${this.renderHeading(th("insp.stand"), th("insp.updated", { date: info.last }))}
      <div class="md-panel text-[13px] leading-[1.55] select-text [&_p+p]:mt-2.5">
        ${md(info.stand || t("insp.noStand"))}
      </div>`;
  }

  private renderProjectReminders(projectName: string) {
    const own = reminders().filter(reminder => reminder.project === projectName);
    if (!own.length) return this.renderNote(th("insp.noRem"));
    const items = own.map(reminder => ({
      text: reminder.title,
      when: this.dueLabel(reminder),
      due: urgency(reminder.days),
    }));
    return html`${this.renderHeading(th("nav.reminders"))}<relay-todo-list .items=${items}></relay-todo-list>`;
  }

  private renderOpenItems(info: ProjectInfo) {
    const openItems: string[] = info.open_items || [];
    return html`${this.renderHeading(th("tab.open"), openItems.length)}${
      openItems.length
        ? html`<relay-todo-list .items=${openItems.map(text => ({ text }))}></relay-todo-list>`
        : this.renderNote(th("insp.noOpen"))
    }`;
  }

  private renderBody() {
    if (panel.open) return this.renderDetail();
    const info = project(selectedProject());
    if (!info) return this.renderToday();
    switch (ui.tab) {
      case "prs":
        return this.renderProjectPrs(info.name);
      case "stand":
        return this.renderStand(info);
      case "rem":
        return this.renderProjectReminders(info.name);
      default:
        return this.renderOpenItems(info);
    }
  }

  private renderTabs() {
    return TABS.map(
      ([id, key]) =>
        html`<button class=${ui.tab === id ? "on" : ""} ?hidden=${id === "prs" && !ghOn()} @click=${() => setTab(id)}>
          ${th(key)}
        </button>`,
    );
  }

  override render() {
    // app chrome is not text: no selection in the bar and the tabs, like a native Mac app
    return html`<div class="flex flex-col flex-1 min-h-0 border-l border-separator">
      <div
        class="h-12 flex-none flex items-center px-3.5 border-b border-separator min-w-75 select-none"
        data-tauri-drag-region
      >
        <div class="seg flex-1 select-none [&>button]:flex-1">${this.renderTabs()}</div>
      </div>
      <div class="overflow-y-auto pt-4.5 px-4.5 pb-6 ${panel.open ? "min-w-115" : "min-w-75"}">
        ${this.renderBody()}
      </div>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-inspector": RelayInspector;
  }
}
