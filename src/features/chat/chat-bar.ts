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
    "open-board": CustomEvent<void>;
    "open-prs": CustomEvent<void>;
    "toggle-drawer": CustomEvent<"terminal" | "notes">;
    "new-reminder": CustomEvent<void>;
    "reload-prs": CustomEvent<void>;
  }
}

const TINT = { "": "text-tertiary", "ctx-a": "text-ctx-a", "ctx-m": "text-ctx-m", "ctx-p": "text-ctx-p" };

/** The title bar of the centre column: the project (or the view), the conversation's title and state, the project's tools (board, pull requests, drawer) and the external terminal button. */
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
  @property({ type: Boolean }) tools = false; // a vault project is open: its tool icons show on the right
  @property({ attribute: false }) board?: { name: string; mark: string }; // the board linked to the project
  @property({ type: Boolean }) gh = false; // GitHub is on: the PRs button shows
  @property({ type: Boolean }) ghLinked = false; // the project has repos; without them the button offers to link one
  @property() active: "" | "board" | "prs" = ""; // the project's board or PRs is what the centre shows
  @property() drawer = ""; // what the right drawer shows, the active tool lights up
  // the conversation title while it is edited: a redraw must not take the text away from under the caret
  private draft: string | null = null;

  private resetTitle(input: HTMLInputElement) {
    input.value = this.value;
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
    this.requestUpdate();
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

  // resumes the conversation in iTerm or WezTerm: it belongs to the conversation, so it sits by its title
  private renderExternalTerminal() {
    return html`<button
      class="btn-icon disabled:opacity-40"
      ?hidden=${this.noTerm}
      ?disabled=${this.locked}
      title=${t(this.locked ? "bar.termMail" : "bar.openTerminal")}
      aria-label=${t("bar.openTerminal")}
      @click=${() => emit(this, "open-terminal")}
    >
      ${icon("term", "glyph size-4")}
    </button>`;
  }

  // one button per tool, the one that is open lit: a second click goes back (a view) or closes the drawer
  private renderTool(on: boolean, label: string, glyph: unknown, event: () => void, dim = false) {
    return html`<button
      class="btn-icon ${on ? "text-accent!" : dim ? "opacity-40 hover:opacity-100" : ""}"
      title=${label}
      aria-label=${label}
      aria-pressed=${on ? "true" : "false"}
      @click=${event}
    >
      ${glyph}
    </button>`;
  }

  private renderTools() {
    if (!this.tools) return nothing;
    const board = this.board;
    return html`${
      board
        ? this.renderTool(this.active === "board", board.name, glyphSvg(board.mark, "glyph size-4", "0 0 24 24"), () =>
            emit(this, "open-board"),
          )
        : nothing
    }${
      this.gh
        ? this.renderTool(
            this.active === "prs",
            this.ghLinked ? t("nav.prs") : t("bar.linkRepo"),
            icon("github", "glyph size-4"),
            () => emit(this, "open-prs"),
            !this.ghLinked,
          )
        : nothing
    }${(["terminal", "notes"] as const).map(tool =>
      this.renderTool(
        this.drawer === tool,
        t(`drawer.${tool}`),
        icon(tool === "terminal" ? "drawerTerm" : "notes", "glyph size-4"),
        () => emit(this, "toggle-drawer", tool),
      ),
    )}`;
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
              <span class="inline-grid min-w-0 max-w-2/5">
                <span
                  class="col-start-1 row-start-1 invisible whitespace-pre overflow-hidden text-sm font-semibold px-1.5"
                  aria-hidden="true"
                  >${shown || " "}</span
                >
                <input
                  class=${"col-start-1 row-start-1 w-full text-sm font-semibold text-label bg-transparent border-0 rounded-md px-1.5 py-0.75 min-w-0 outline-0 text-ellipsis focus:bg-fill" + (this.readonly ? "" : " hover:bg-fill")}
                  spellcheck="false"
                  aria-label=${t("bar.chatTitle")}
                  ?readonly=${this.readonly}
                  title=${this.readonly ? t("chat.titleFromTerm") : t("chat.titleEdit")}
                  .value=${live(shown)}
                  @input=${this.onTitleInput}
                  @keydown=${this.onTitleKey}
                  @change=${this.onTitleChange}
                /> </span
              >${this.renderExternalTerminal()}`
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
      ${this.renderTools()}
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-chat-bar": ChatBar;
  }
}
