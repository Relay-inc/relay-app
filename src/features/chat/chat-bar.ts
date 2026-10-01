import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { ifDefined } from "lit/directives/if-defined.js";
import { t } from "../../core/i18n";
import { emit } from "../../core/dom";
import { glyphSvg, icon, iconImg } from "../../core/icons";
import { tw } from "../../core/styles";

declare global {
  interface HTMLElementEventMap {
    "edit-project": CustomEvent<void>;
    rename: CustomEvent<string>;
    "open-terminal": CustomEvent<void>;
    "toggle-panel": CustomEvent<void>;
  }
}

const tb =
  "h-6 rounded-lg border-0 bg-transparent cursor-default whitespace-nowrap transition-colors duration-(--d) ease-(--ease) hover:bg-fill focus-visible:outline-3 focus-visible:outline-accent/45 focus-visible:outline-offset-1";

/** The title bar of the centre column: the project (or the view) and the conversation's title, the terminal and the right panel buttons. */
@customElement("relay-chat-bar")
export class ChatBar extends LitElement {
  static override styles = [
    tw,
    css`
      :host {
        display: block;
        flex: none;
      }
    `,
  ];
  @property() heading = "";
  @property() img = ""; // the project's icon, an image data url
  @property({ type: Boolean }) editable = false; // a conversation, not a view: the heading opens the project panel, the title is shown
  @property() sub = "";
  @property() value = ""; // the conversation's title
  @property({ type: Boolean }) readonly = false; // a terminal session takes its title from the transcript
  @property({ type: Boolean }) renamable = false;
  @property({ type: Boolean }) noTerm = false;
  @property({ type: Boolean }) locked = false; // the terminal would resume a conversation that touched mail without the app's restrictions
  @property({ type: Boolean }) panelOff = false;
  // the conversation title while it is edited: a redraw must not take the text away from under the caret
  private draft: string | null = null;

  private reset(ct: HTMLInputElement) {
    ct.value = this.value;
    ct.size = Math.max(4, this.value.length);
    this.draft = null;
  }
  private onTitleKey(e: KeyboardEvent) {
    const ct = e.target as HTMLInputElement;
    if (e.key === "Enter") {
      e.preventDefault();
      ct.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      this.reset(ct);
      ct.blur();
    }
  }
  private onTitleChange(e: Event) {
    const ct = e.target as HTMLInputElement,
      v = ct.value.trim();
    if (!this.renamable || !v) this.reset(ct);
    else {
      this.draft = null;
      emit(this, "rename", v);
    }
  }

  override render() {
    const shown = this.draft ?? this.value;
    return html`<div
      class="h-13 flex items-center gap-2.5 px-5 border-b border-separator select-none"
      data-tauri-drag-region
    >
      <h1
        class=${
          "text-base font-semibold flex-none max-w-2/5 whitespace-nowrap overflow-hidden text-ellipsis cursor-default rounded-md px-1.5 py-0.5 -ml-1.5" +
          (this.editable
            ? " hover:bg-fill after:inline-block after:ml-1.5 after:w-0 after:h-0 after:border-t-4 after:border-t-secondary after:border-x-4 after:border-x-transparent after:align-middle"
            : "")
        }
        title=${ifDefined(this.editable ? t("chat.editTitle") : undefined)}
        @click=${() => emit(this, "edit-project")}
      >
        ${iconImg(this.img, "inline w-4 h-4 flex-none object-contain rounded-xs mr-1.5")}${this.heading}
      </h1>
      ${
        this.editable
          ? html`<span class="text-secondary -mx-1">›</span>
              <input
                class=${"text-base text-label bg-transparent border-0 rounded-md px-1.5 py-0.5 min-w-0 max-w-2/5 outline-0 text-ellipsis focus:bg-fill" + (this.readonly ? "" : " hover:bg-fill")}
                spellcheck="false"
                aria-label=${t("bar.chatTitle")}
                ?readonly=${this.readonly}
                title=${this.readonly ? t("chat.titleFromTerm") : t("chat.titleEdit")}
                size=${Math.max(4, shown.length)}
                .value=${live(shown)}
                @input=${(e: Event) => {
                  const ct = e.target as HTMLInputElement;
                  this.draft = ct.value;
                  ct.size = Math.max(4, ct.value.length);
                }}
                @keydown=${this.onTitleKey}
                @change=${this.onTitleChange}
              />`
          : nothing
      }
      <span class="text-secondary whitespace-nowrap overflow-hidden text-ellipsis">${this.sub}</span
      ><span class="flex-1" data-tauri-drag-region></span>
      <button
        class="${tb} w-7 p-0 grid place-items-center text-secondary hover:text-label"
        ?hidden=${this.noTerm}
        ?disabled=${this.locked}
        title=${t(this.locked ? "bar.termMail" : "bar.openTerminal")}
        aria-label=${t("bar.openTerminal")}
        @click=${() => emit(this, "open-terminal")}
      >
        ${icon("term", "glyph size-4")}
      </button>
      <button
        class="${tb} w-7 p-0 grid place-items-center ${this.panelOff ? "text-accent" : "text-secondary hover:text-label"}"
        title=${t("bar.togglePanelTitle")}
        aria-label=${t("bar.togglePanel")}
        @click=${() => emit(this, "toggle-panel")}
      >
        ${glyphSvg('<rect x="2.5" y="3" width="11" height="10" rx="1.5"/><path d="M10 3v10"/>', "glyph size-4")}
      </button>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-chat-bar": ChatBar;
  }
}
