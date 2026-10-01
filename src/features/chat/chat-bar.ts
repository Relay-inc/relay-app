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
    "new-reminder": CustomEvent<void>;
    "reload-prs": CustomEvent<void>;
  }
}

const TINT = { "": "text-tertiary", "ctx-a": "text-ctx-a", "ctx-m": "text-ctx-m", "ctx-p": "text-ctx-p" };

/** The title bar of the centre column: the project (or the view), the conversation's title and state, the terminal and the right panel buttons. */
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
  @property() tint: keyof typeof TINT = ""; // the colour of the project's folder icon
  @property() state: "" | "busy" | "idle" = ""; // the conversation's state pill; "" shows none
  @property({ type: Boolean }) editable = false; // a conversation, not a view: the heading opens the project panel, the title is shown
  @property() sub = "";
  @property() value = ""; // the conversation's title
  @property({ type: Boolean }) readonly = false; // a terminal session takes its title from the transcript
  @property({ type: Boolean }) renamable = false;
  @property({ type: Boolean }) noTerm = false;
  @property({ type: Boolean }) locked = false; // the terminal would resume a conversation that touched mail without the app's restrictions
  @property({ type: Boolean }) remNew = false; // the reminders view: a button opens the new-reminder form
  @property({ type: Boolean }) prs = false; // the pull requests view: when the list arrived, and a reload button
  @property({ type: Number }) prsAt = 0;
  @property({ type: Boolean }) prsBusy = false;
  @property({ type: Boolean }) panelOff = false;
  // the conversation title while it is edited: a redraw must not take the text away from under the caret
  private draft: string | null = null;

  private resetTitle(input: HTMLInputElement) {
    input.value = this.value;
    input.size = Math.max(4, this.value.length);
    this.draft = null;
  }
  private onTitleKey(e: KeyboardEvent) {
    const input = e.target as HTMLInputElement;
    if (e.key === "Enter") {
      e.preventDefault();
      input.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      this.resetTitle(input);
      input.blur();
    }
  }
  private onTitleChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const title = input.value.trim();
    if (!this.renamable || !title) {
      this.resetTitle(input);
      return;
    }
    this.draft = null;
    emit(this, "rename", title);
  }
  private onTitleInput(e: Event) {
    const input = e.target as HTMLInputElement;
    this.draft = input.value;
    input.size = Math.max(4, input.value.length);
  }

  private renderState() {
    if (!this.state) return nothing;
    const busy = this.state === "busy";
    return html`<span
      class="h-5 px-2 rounded-full bg-fill-2 text-secondary text-[11px] font-medium inline-flex items-center gap-1.25 whitespace-nowrap"
      ><span class="size-1.5 rounded-full ${busy ? "bg-soon" : "bg-ok"}"></span
      >${t(busy ? "bar.working" : "bar.ready")}</span
    >`;
  }

  private renderPrs() {
    if (!this.prs) return nothing;
    const minutes = Math.floor((Date.now() - this.prsAt) / 6e4);
    const updated = !this.prsAt
      ? nothing
      : minutes < 1
        ? t("pr.updatedNow")
        : minutes < 60
          ? t("pr.updatedMin", { n: minutes })
          : t("pr.updatedHour", { n: Math.floor(minutes / 60) });
    return html`<span class="text-xs text-tertiary mr-1">${updated}</span
      ><button
        class="btn-icon disabled:opacity-40 cursor-pointer"
        ?disabled=${this.prsBusy}
        title=${t("pr.reload")}
        aria-label=${t("pr.reload")}
        @click=${() => emit(this, "reload-prs")}
      >
        ${icon("refresh", `glyph size-4 ${this.prsBusy ? "animate-spin" : ""}`)}
      </button>`;
  }

  override render() {
    const shown = this.draft ?? this.value;
    const lead = this.img
      ? iconImg(this.img, "size-3.5 flex-none object-contain rounded-xs")
      : this.editable
        ? icon("folder", `glyph size-3.5 flex-none ${TINT[this.tint]}`)
        : nothing;
    return html`<div
      class="h-12 flex items-center gap-2 pl-5 pr-3 border-b border-separator select-none"
      data-tauri-drag-region
    >
      <h1
        class=${
          "flex items-center gap-1.5 text-sm font-normal flex-none max-w-2/5 whitespace-nowrap overflow-hidden text-ellipsis cursor-default rounded-md px-1.5 py-0.75 -ml-1.5 text-secondary" +
          (this.editable ? " hover:bg-fill hover:text-label" : "")
        }
        title=${ifDefined(this.editable ? t("chat.editTitle") : undefined)}
        @click=${() => emit(this, "edit-project")}
      >
        ${lead}${this.heading}
      </h1>
      ${
        this.editable
          ? html`<span class="text-tertiary">/</span>
              <input
                class=${"text-sm font-semibold text-label bg-transparent border-0 rounded-md px-1.5 py-0.75 min-w-0 max-w-2/5 outline-0 text-ellipsis focus:bg-fill" + (this.readonly ? "" : " hover:bg-fill")}
                spellcheck="false"
                aria-label=${t("bar.chatTitle")}
                ?readonly=${this.readonly}
                title=${this.readonly ? t("chat.titleFromTerm") : t("chat.titleEdit")}
                size=${Math.max(4, shown.length)}
                .value=${live(shown)}
                @input=${this.onTitleInput}
                @keydown=${this.onTitleKey}
                @change=${this.onTitleChange}
              />`
          : nothing
      }
      <span class="text-secondary whitespace-nowrap overflow-hidden text-ellipsis">${this.sub}</span
      >${this.renderState()}<span class="flex-1" data-tauri-drag-region></span>
      ${
        this.remNew
          ? html`<button
              class="btn h-7 px-2.5 rounded-[7px] text-xs inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
              @click=${() => emit(this, "new-reminder")}
            >
              ${icon("add", "glyph size-3.5")}${t("rem.new")}
            </button>`
          : nothing
      }${this.renderPrs()}
      <button
        class="btn-icon disabled:opacity-40"
        ?hidden=${this.noTerm}
        ?disabled=${this.locked}
        title=${t(this.locked ? "bar.termMail" : "bar.openTerminal")}
        aria-label=${t("bar.openTerminal")}
        @click=${() => emit(this, "open-terminal")}
      >
        ${icon("term", "glyph size-4")}
      </button>
      <button
        class="btn-icon ${this.panelOff ? "text-accent!" : ""}"
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
