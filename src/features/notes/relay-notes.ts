import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { t } from "../../core/i18n";
import { StoreController } from "../../core/store";
import { tw } from "../../core/styles";
import { scratch, loadScratch, newScratch, select, edit, deleteScratch, title } from "../../domain/scratch";

/** Plain-text scratch notes of one project: a list on top, the open note below as a monospace field that saves as you type. */
@customElement("relay-notes")
export class RelayNotes extends LitElement {
  static override styles = [
    tw,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
      }
    `,
  ];
  protected store = new StoreController(this);
  @property() project = "";

  protected override willUpdate(changedProps: Map<string, unknown>) {
    if (changedProps.has("project") && this.project && this.project !== scratch.project) loadScratch(this.project);
  }

  override render() {
    const open = scratch.open;
    return html`<div class="flex items-center gap-2 mb-2">
        <button class="btn btn-primary h-7.5 px-3 rounded-lg text-[13px] cursor-pointer" @click=${newScratch}>
          + ${t("notes.new")}
        </button>
        ${open
          ? html`<button
              class="btn h-7.5 px-3 rounded-lg text-[13px] cursor-pointer ml-auto"
              @click=${() => deleteScratch(open)}
            >
              ${t("notes.delete")}
            </button>`
          : ""}
      </div>
      <div class="flex flex-col max-h-40 overflow-y-auto mb-2">
        ${scratch.notes.map(
          note => html`<button
            class="text-left text-[13px] px-2 py-1 rounded-md cursor-pointer truncate ${note === open ? "bg-fill-2" : "hover:bg-fill"}"
            @click=${() => select(note)}
          >
            ${title(note)}
          </button>`,
        )}
      </div>
      ${open
        ? html`<textarea
            class="flex-1 min-h-0 w-full resize-none rounded-lg bg-fill p-3 font-mono text-[13px] outline-none focus:outline-2 focus:outline-accent/45"
            .value=${open.text}
            placeholder=${t("notes.placeholder")}
            @input=${(e: Event) => edit(open, (e.target as HTMLTextAreaElement).value)}
          ></textarea>`
        : html`<div class="text-secondary">${t("notes.empty")}</div>`}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-notes": RelayNotes;
  }
}
