import { html, nothing } from "lit";
import { live } from "lit/directives/live.js";
import { t } from "../i18n";
import { RelayElement, styles } from "../lib/store";
import { iconImg, iconFrom, isImg } from "../project-icons";
import { S, selProject } from "../app/state";
import { savePop, closePop } from "../app/actions";
import css from "./pop.css?inline";

/** Which project this conversation belongs to, and the project's icon and name. */
export class RelayPop extends RelayElement {
  static styles = styles(css);
  // what is chosen in the open panel: the project, an image or an emoji (an image replaces the emoji and the other way round), the label
  private proj: string | null = null;
  private img: string | undefined;
  private emoji = "";
  private lab = "";
  private err = "";

  connectedCallback() {
    super.connectedCallback();
    const cur = selProject();
    this.proj = cur;
    this.img = (cur ? S.icons[cur]?.img : undefined) ?? undefined;
    this.emoji = this.img || !cur ? "" : S.icons[cur]?.icon || "";
    this.lab = cur ? S.settings.projects[cur]?.label || "" : "";
  }
  firstUpdated() { this.renderRoot.querySelector("select")?.focus(); }

  private async pickFile(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return;
    const u = await iconFrom(f);
    if (!u) { this.err = t("img.unreadable"); this.requestUpdate(); return; }
    this.img = u; this.emoji = ""; this.requestUpdate();
  }
  private async save() {
    const cur = selProject();
    this.err = await savePop(this.proj, cur ? { img: this.img, emoji: this.emoji.trim(), label: this.lab.trim() } : undefined);
    this.requestUpdate();
  }

  render() {
    const cur = selProject(), names = S.snap.projects.map((p: any) => p.name).sort((a: string, b: string) => a.localeCompare(b));
    return html`${this.err ? html`<div class="err">${this.err}</div>` : nothing}
      <label class="plab">${t("pop.project")}
        <select @change=${(e: Event) => { this.proj = (e.target as HTMLSelectElement).value || null; }}><option value="" .selected=${!this.proj}>${t("general")}</option>${names.map((n: string) => html`<option .selected=${n === this.proj}>${n}</option>`)}</select></label>
      ${cur ? html`<div class="plab">${t("pop.sidebar", { name: cur })}
        <div class="setrow"><label class="btn picon" title=${t("pop.imgPick")}>${isImg(this.img) ? iconImg(this.img) : t("pop.img")}<input type="file" accept="image/*,.ico,.svg" hidden @change=${this.pickFile}></label>
          <input class="field ico" maxlength="4" placeholder="Emoji" .value=${live(this.emoji)} @input=${(e: Event) => { this.emoji = (e.target as HTMLInputElement).value; if (this.img) { this.img = undefined; this.requestUpdate(); } }}>
          <input class="field" placeholder=${cur} .value=${live(this.lab)} @input=${(e: Event) => { this.lab = (e.target as HTMLInputElement).value; }}></div></div>` : nothing}
      <div class="acts"><button class="btn" @click=${closePop}>${t("pop.cancel")}</button><button class="btn primary" @click=${this.save}>${t("pop.save")}</button></div>`;
  }
}
customElements.define("relay-pop", RelayPop);
