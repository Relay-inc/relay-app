import { LitElement, css, html, nothing } from "lit";
import { customElement } from "lit/decorators.js";
import { t } from "../../core/i18n";
import { StoreController } from "../../core/store";
import { tw } from "../../core/styles";
import { icon } from "../../core/icons";
import { mdDefaults } from "../../components/md-defaults";
import { ui } from "../../domain/ui";
import { panel, cardOf, closeDrawer, cardAct, type CardAct } from "../../domain/panel";
import { cardChat } from "../../domain/card-chat";
import { panelItem } from "../../domain/keys";
import "../notes/relay-note-detail";

const TITLES = { detail: "drawer.detail", terminal: "drawer.terminal", notes: "drawer.notes" } as const;

/** The right drawer, open on demand: a card or note detail, or one of the project's tools (terminals, notes). */
@customElement("relay-drawer")
export class RelayDrawer extends LitElement {
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
              @detail-close=${closeDrawer}
              @detail-act=${(e: CustomEvent<CardAct>) => cardAct(key, e.detail)}
              @detail-chat=${() => cardChat(key)}
            >
              ${panel.actErr ? html`<div class="err-box mb-3">${panel.actErr}</div>` : nothing}${card.detail.render(panel.detail[key] ?? null, panel.err)}
            </div>`
          : nothing;
      }
      case "note":
        return html`<relay-note-detail></relay-note-detail>`;
      default:
        return nothing;
    }
  }

  private renderBody() {
    switch (ui.drawer) {
      case "terminal":
        // TODO(project-terminals): render html`<relay-terminals .project=${selectedProject()}></relay-terminals>` once that branch lands
        return nothing;
      case "notes":
        // TODO(project-notes): render html`<relay-notes .project=${selectedProject()}></relay-notes>` once that branch lands
        return nothing;
      default:
        return this.renderDetail();
    }
  }

  override render() {
    // app chrome is not text: no selection in the bar, like a native Mac app
    return html`<div class="flex flex-col flex-1 min-h-0 border-l border-separator">
      <div
        class="h-12 flex-none flex items-center gap-2 pl-4.5 pr-3 border-b border-separator min-w-115 select-none"
        data-tauri-drag-region
      >
        <h2 class="flex-1 text-[15px] font-semibold">${ui.drawer ? t(TITLES[ui.drawer]) : ""}</h2>
        <button class="btn-icon" title=${t("pr.close")} aria-label=${t("nav.close")} @click=${closeDrawer}>
          ${icon("close", "glyph size-4")}
        </button>
      </div>
      <div class="overflow-y-auto pt-4.5 px-4.5 pb-6 min-w-115">${this.renderBody()}</div>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-drawer": RelayDrawer;
  }
}
