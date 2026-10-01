import { LitElement, css, html, nothing } from "lit";
import { customElement } from "lit/decorators.js";
import { t, th } from "../../core/i18n";
import { md } from "../../core/markdown";
import { StoreController } from "../../core/store";
import { tw } from "../../core/styles";
import { mdDefaults } from "../../components/md-defaults";
import { ui } from "../../domain/ui";
import { ghOn } from "../../domain/config";
import { project, pLabel } from "../../domain/vault";
import { selProject } from "../../domain/chats/state";
import { panel, setTab, cardOf, closeDetail, openDetail } from "../../domain/panel";
import { prs, type PR } from "../../domain/prs";
import { panelItem, prKey } from "../../domain/keys";
import { reminders, urgency, type Reminder } from "../../domain/reminders";
import "./todo-list";
import "../pull-requests/pr-row";
import "../pull-requests/relay-pr-detail";
import "../mail/relay-mail-detail";
import "../notes/relay-note-detail";

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
        background: var(--inspector);
      }
    `,
  ];
  protected store = new StoreController(this);

  private detail() {
    const key = panel.open;
    switch (panelItem(key)?.kind) {
      case "card": {
        // the card's markup comes from its provider package, which tells the panel through an event that its close button was clicked
        const card = cardOf(key);
        return card
          ? html`<div @detail-close=${closeDetail}>${card.d.render(panel.detail[key] ?? null, panel.err)}</div>`
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

  private heading(title: unknown, n?: number) {
    return html`<h2 class="text-sm font-semibold mb-2">
      ${title}${n === undefined ? "" : html` <span class="text-secondary tabular-nums">${n}</span>`}
    </h2>`;
  }
  private meta(text: unknown) {
    return html`<div class="text-secondary mb-3">${text}</div>`;
  }

  private prRow(p: PR, mine: boolean) {
    const key = prKey(p.repo, p.number);
    return html`<relay-pr-row
      compact
      .pr=${p}
      ?mine=${mine}
      .project=${p.project ? pLabel(p.project) : ""}
      ?selected=${panel.open === key}
      @open-pr=${() => openDetail(key)}
    ></relay-pr-row>`;
  }

  private body() {
    if (panel.open) return this.detail();
    const P = project(selProject());
    if (!P) {
      const due = reminders().filter(r => r.days <= 0);
      return html`${this.heading(th("insp.today"), due.length)}${
        due.length
          ? html`<relay-todo-list
              .items=${due.map(r => ({
                text: r.title,
                project: r.project || "",
                due: urgency(r.days),
                when: r.days < 0 ? th("due.overdue", { n: -r.days }) : th("due.today"),
              }))}
            ></relay-todo-list>`
          : this.meta(th("insp.nothingDue"))
      }`;
    }
    const rem = reminders().filter(r => r.project === P.name);
    const when = (r: Reminder) =>
      r.days < 0 ? th("due.overdue", { n: -r.days }) : r.days === 0 ? th("due.today") : th("due.in", { n: r.days });
    const items: string[] = P.open_items || [];
    if (ui.tab === "prs") {
      if (!prs.list) return this.meta(th("pr.loading"));
      const review = prs.list.review.filter(p => p.project === P.name),
        mine = prs.list.mine.filter(p => p.project === P.name);
      return html`${this.heading(th("nav.prs"), review.length + mine.length)}${
        review.length + mine.length
          ? html`<div>${review.map(p => this.prRow(p, false))}${mine.map(p => this.prRow(p, true))}</div>`
          : this.meta(th("pr.noneProject"))
      }`;
    }
    if (ui.tab === "stand")
      return html`${this.heading(th("insp.stand"))}${this.meta(th("insp.updated", { date: P.last }))}
        <div class="md-panel [&_p+p]:mt-2">${md(P.stand || t("insp.noStand"))}</div>`;
    if (ui.tab === "rem")
      return rem.length
        ? html`${this.heading(th("nav.reminders"))}<relay-todo-list
              .items=${rem.map(r => ({ text: r.title, when: when(r), due: urgency(r.days) }))}
            ></relay-todo-list>`
        : this.meta(th("insp.noRem"));
    return html`${this.heading(th("tab.open"), items.length)}${items.length ? html`<relay-todo-list .items=${items.map(text => ({ text }))}></relay-todo-list>` : this.meta(th("insp.noOpen"))}`;
  }

  override render() {
    this.toggleAttribute("wide", !!panel.open);
    if (ui.tab === "prs" && !ghOn()) ui.tab = "open";
    // app chrome is not text: no selection in the bar and the tabs, like a native Mac app
    return html`<div class="flex flex-col flex-1 min-h-0 border-l border-separator">
      <div
        class="h-13 flex-none flex items-center gap-2.5 px-5 border-b border-separator min-w-75 select-none"
        data-tauri-drag-region
      >
        <div class="seg select-none">
          ${TABS.map(
            ([id, key]) =>
              html`<button
                class=${ui.tab === id ? "on" : ""}
                ?hidden=${id === "prs" && !ghOn()}
                @click=${() => setTab(id)}
              >
                ${th(key)}
              </button>`,
          )}
        </div>
      </div>
      <div class="overflow-y-auto pt-4 px-4 pb-6 ${panel.open ? "min-w-115" : "min-w-75"}">${this.body()}</div>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-inspector": RelayInspector;
  }
}
