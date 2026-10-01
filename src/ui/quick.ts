import { html } from "lit";
import { t } from "../i18n";
import { RelayElement, styles, changed } from "../lib/store";
import { S } from "../app/state";
import type { Img } from "../app/state";
import { attach, unattach, quickSend } from "../app/actions";
import { thumbs, pastedImages, hasFiles } from "./parts";
import parts from "./parts.css?inline";
import css from "./quick.css?inline";

/** Cmd-K: one question that becomes a new general conversation in the background, the open screen stays. Mounted while `S.qk`. */
export class RelayQuick extends RelayElement {
  static styles = styles(parts + css);
  private imgs: Img[] = []; // images waiting in the field, dropped when it closes without sending
  private sent = false;
  private get ta() { return this.renderRoot.querySelector("textarea") as HTMLTextAreaElement; }

  firstUpdated() { this.ta.focus(); }
  disconnectedCallback() {
    super.disconnectedCallback();
    if (!this.sent) this.imgs.forEach(i => URL.revokeObjectURL(i.url));
  }
  private close() { S.qk = false; changed(); }
  private grow() { const ta = this.ta; ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; }
  private onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      if (S.zoom) return; // the app closes the image first
      e.preventDefault(); e.stopPropagation(); this.close(); return;
    }
    if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
    e.preventDefault();
    const text = this.ta.value.trim(); if (!text && !this.imgs.length) return;
    this.sent = true; this.close();
    quickSend(text, this.imgs);
  }
  private onDrop(e: DragEvent) {
    if (!hasFiles(e)) return;
    e.preventDefault(); attach([...e.dataTransfer!.files], this.imgs);
  }

  render() {
    return html`<div class="qk" @click=${(e: Event) => { if (e.target === e.currentTarget) this.close(); }}>
      <div class="qkbox" @dragover=${(e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); }} @drop=${this.onDrop}>
        <div class="atts" ?hidden=${!this.imgs.length}>${thumbs(this.imgs.map(a => a.url), i => { unattach(i, this.imgs); this.ta.focus(); })}</div>
        <textarea rows="1" spellcheck="false" placeholder=${t("qk.ph")} aria-label=${t("qk.label")} @input=${this.grow} @keydown=${this.onKey}
          @paste=${(e: ClipboardEvent) => { const f = pastedImages(e); if (f.length) attach(f, this.imgs); }}></textarea>
        <div class="qkhint">${t("qk.hint")}</div></div></div>`;
  }
}
customElements.define("relay-quick", RelayQuick);
