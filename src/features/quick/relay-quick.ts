import { LitElement, html, css, nothing } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { ifDefined } from "lit/directives/if-defined.js";
import { t } from "../../core/i18n";
import { StoreController } from "../../core/store";
import { tw } from "../../core/styles";
import { ui } from "../../domain/ui";
import type { Img } from "../../domain/chats/state";
import { attach, unattach, quickSend } from "../../domain/chats/actions";
import { toggleQuickAsk, zoom, openProject } from "../../domain/navigation";
import { vault, projectLabel } from "../../domain/vault";
import { config } from "../../domain/config";
import { searchProjects } from "../../domain/project-search";
import { pastedImages, hasFiles } from "../../components/image-files";
import "../../components/image-thumbs";

/** Cmd-K: open a matching project, or send a quick question in the background. Mounted while `ui.quickAsk`. */
@customElement("relay-quick")
export class RelayQuick extends LitElement {
  static override styles = [
    tw,
    css`
      :host {
        display: contents;
      }
    `,
  ];
  protected store = new StoreController(this);
  private images: Img[] = []; // images waiting in the field, dropped when it closes without sending
  private sent = false;
  @state() private typed = "";
  @state() private picked = -1; // no project selected: Enter keeps asking a quick question
  @query("textarea") private field!: HTMLTextAreaElement;

  override firstUpdated() {
    this.field.focus();
  }
  override disconnectedCallback() {
    super.disconnectedCallback();
    if (!this.sent) this.images.forEach(image => URL.revokeObjectURL(image.url));
  }
  private close() {
    toggleQuickAsk(false);
  }
  private grow() {
    this.typed = this.field.value;
    this.picked = -1;
    this.field.style.height = "auto";
    this.field.style.height = this.field.scrollHeight + "px";
  }
  private get projects() {
    if (this.images.length || this.typed.includes("\n")) return [];
    return searchProjects(
      vault.snap.projects.map(project => ({
        ...project,
        label: config.value.projects[project.name]?.label,
      })),
      this.typed,
    );
  }
  private chooseProject(name: string) {
    this.close();
    openProject(name);
  }
  private onKey(e: KeyboardEvent) {
    if (e.isComposing) return;
    if (e.key === "Escape") {
      if (ui.zoom) return; // the app closes the image first
      e.preventDefault();
      e.stopPropagation();
      this.close();
      return;
    }
    const projects = this.projects;
    if (projects.length && !e.shiftKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      const count = projects.length + 1; // include the quick-question choice at -1
      this.picked = ((this.picked + 1 + (e.key === "ArrowDown" ? 1 : -1) + count) % count) - 1;
      return;
    }
    if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
    e.preventDefault();
    const project = projects[this.picked];
    if (project) {
      this.chooseProject(project.name);
      return;
    }
    const text = this.field.value.trim();
    if (!text && !this.images.length) return;
    this.sent = true;
    this.close();
    quickSend(text, this.images);
  }
  private onPaste(e: ClipboardEvent) {
    const files = pastedImages(e);
    if (files.length) {
      this.picked = -1;
      attach(files, this.images);
    }
  }
  private onDrop(e: DragEvent) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    this.picked = -1;
    attach([...e.dataTransfer!.files], this.images);
  }

  // the textarea keeps the browser's own 2px padding and grey placeholder, as it always had
  override render() {
    const projects = this.projects;
    return html`<div
      class="fixed inset-0 z-25 flex justify-center items-start px-10 pt-36 bg-black/20"
      @click=${(e: Event) => {
        if (e.target === e.currentTarget) this.close();
      }}
    >
      <div
        class="w-full max-w-xl bg-bg border border-separator rounded-xl shadow-2xl px-4 pt-3.5 pb-2.5"
        role="dialog"
        aria-label=${t("qk.label")}
        aria-modal="true"
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === "Escape" && !e.isComposing && !ui.zoom) {
            e.stopPropagation();
            this.close();
          }
        }}
        @dragover=${(e: DragEvent) => {
          if (hasFiles(e)) e.preventDefault();
        }}
        @drop=${this.onDrop}
      >
        ${
          this.images.length
            ? html`<relay-image-thumbs
                class="mb-2"
                removable
                .urls=${this.images.map(image => image.url)}
                @remove=${(e: CustomEvent<number>) => {
                  unattach(e.detail, this.images);
                  this.field.focus();
                }}
                @open=${(e: CustomEvent<string>) => zoom(e.detail)}
              ></relay-image-thumbs>`
            : nothing
        }
        <textarea
          class="w-full border-0 outline-0 resize-none bg-transparent text-label text-lg leading-snug font-sans max-h-80 overflow-y-auto p-0.5 placeholder:text-secondary"
          rows="1"
          spellcheck="false"
          placeholder=${t("qk.ph")}
          aria-label=${t("qk.label")}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded=${projects.length > 0 ? "true" : "false"}
          aria-controls="quick-projects"
          aria-activedescendant=${ifDefined(projects[this.picked] ? `quick-project-${this.picked}` : undefined)}
          @input=${this.grow}
          @keydown=${this.onKey}
          @paste=${this.onPaste}
        ></textarea>
        <div id="quick-projects" role="listbox" aria-label=${t("qk.projects")}>
          ${projects.map(
            (project, i) =>
              html`<button
                id=${`quick-project-${i}`}
                type="button"
                role="option"
                aria-selected=${this.picked === i ? "true" : "false"}
                tabindex="-1"
                class="flex items-center gap-3 w-full text-left border-0 rounded-lg px-2.5 py-2 mt-1 cursor-pointer text-label ${this.picked === i ? "bg-fill-2" : "bg-transparent hover:bg-fill"}"
                @mousedown=${(e: MouseEvent) => e.preventDefault()}
                @click=${() => this.chooseProject(project.name)}
              >
                <span class="flex-1 min-w-0 truncate text-[13px] font-medium">${projectLabel(project.name)}</span>
                <span class="text-xs text-secondary truncate max-w-40">${project.context}</span>
              </button>`,
          )}
        </div>
        <div class="text-xs text-secondary mt-1.5">${t(projects[this.picked] ? "qk.openHint" : "qk.hint")}</div>
      </div>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-quick": RelayQuick;
  }
}
