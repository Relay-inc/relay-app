import { LitElement, html, css, nothing } from "lit";
import { customElement, query } from "lit/decorators.js";
import { t } from "../../core/i18n";
import { StoreController } from "../../core/store";
import { tw } from "../../core/styles";
import { ui } from "../../domain/ui";
import type { Img } from "../../domain/chats/state";
import { attach, unattach, quickSend } from "../../domain/chats/actions";
import { toggleQuick, zoom } from "../../domain/navigation";
import { pastedImages, hasFiles } from "../../components/image-files";
import "../../components/image-thumbs";

/** Cmd-K: one question that becomes a new general conversation in the background, the open screen stays. Mounted while `ui.qk`. */
@customElement("relay-quick")
export class RelayQuick extends LitElement {
  static styles = [
    tw,
    css`
      :host {
        display: contents;
      }
    `,
  ];
  protected store = new StoreController(this);
  private imgs: Img[] = []; // images waiting in the field, dropped when it closes without sending
  private sent = false;
  @query("textarea") private ta!: HTMLTextAreaElement;

  firstUpdated() {
    this.ta.focus();
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    if (!this.sent) this.imgs.forEach(i => URL.revokeObjectURL(i.url));
  }
  private close() {
    toggleQuick(false);
  }
  private grow() {
    const ta = this.ta;
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + "px";
  }
  private onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      if (ui.zoom) return; // the app closes the image first
      e.preventDefault();
      e.stopPropagation();
      this.close();
      return;
    }
    if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
    e.preventDefault();
    const text = this.ta.value.trim();
    if (!text && !this.imgs.length) return;
    this.sent = true;
    this.close();
    quickSend(text, this.imgs);
  }
  private onDrop(e: DragEvent) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    attach([...e.dataTransfer!.files], this.imgs);
  }

  // the textarea keeps the browser's own 2px padding and grey placeholder, as it always had
  render() {
    return html`<div
      class="fixed inset-0 z-25 flex justify-center items-start px-10 pt-36 bg-black/20"
      @click=${(e: Event) => {
        if (e.target === e.currentTarget) this.close();
      }}
    >
      <div
        class="w-full max-w-xl bg-bg border border-separator rounded-xl shadow-2xl px-4 pt-3.5 pb-2.5"
        @dragover=${(e: DragEvent) => {
          if (hasFiles(e)) e.preventDefault();
        }}
        @drop=${this.onDrop}
      >
        ${
          this.imgs.length
            ? html`<relay-image-thumbs
                class="mb-2"
                removable
                .urls=${this.imgs.map(a => a.url)}
                @remove=${(e: CustomEvent<number>) => {
                  unattach(e.detail, this.imgs);
                  this.ta.focus();
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
          @input=${this.grow}
          @keydown=${this.onKey}
          @paste=${(e: ClipboardEvent) => {
            const f = pastedImages(e);
            if (f.length) {
              attach(f, this.imgs);
            }
          }}
        ></textarea>
        <div class="text-xs text-secondary mt-1.5">${t("qk.hint")}</div>
      </div>
    </div>`;
  }
}
