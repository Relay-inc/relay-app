import { LitElement, html, css, nothing } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { t } from "../../core/i18n";
import { iconImg, isImg } from "../../core/icons";
import { StoreController } from "../../core/store";
import { tw } from "../../core/styles";
import { config } from "../../domain/config";
import { vault } from "../../domain/vault";
import { iconFrom } from "../../domain/icons";
import { selectedProject } from "../../domain/chats/state";
import { savePop } from "../../domain/chats/actions";
import { closeProjectPanel } from "../../domain/navigation";

// a long project name in the select or the inputs never pushes past the panel
const fieldLabel = "grid grid-cols-1 gap-1.5 text-sm text-secondary select-none";

/** Which project this conversation belongs to, and the project's icon and name. Opens under the title; a second container, it saves on its own. */
@customElement("relay-project-panel")
export class ProjectPanel extends LitElement {
  static override styles = [
    tw,
    css`
      :host {
        position: absolute;
        z-index: 5;
        top: 56px;
        right: 16px;
        width: 340px;
        display: block;
      }
    `,
  ];
  protected store = new StoreController(this);
  // what is chosen in the open panel: the project, an image or an emoji (an image replaces the emoji and the other way round), the label
  private projectName: string | null = null;
  private label = "";
  @state() private img: string | undefined;
  @state() private emoji = "";
  @state() private err = "";

  override connectedCallback() {
    super.connectedCallback();
    const current = selectedProject();
    this.projectName = current;
    this.img = (current ? vault.icons[current]?.img : undefined) ?? undefined;
    this.emoji = this.img || !current ? "" : vault.icons[current]?.icon || "";
    this.label = current ? config.value.projects[current]?.label || "" : "";
  }
  @query("select") private projectSelect?: HTMLSelectElement;
  override firstUpdated() {
    this.projectSelect?.focus();
  }

  private async pickFile(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const dataUrl = await iconFrom(file);
    if (!dataUrl) {
      this.err = t("img.unreadable");
      return;
    }
    this.img = dataUrl;
    this.emoji = "";
  }
  private async save() {
    const edited = selectedProject()
      ? { img: this.img, emoji: this.emoji.trim(), label: this.label.trim() }
      : undefined;
    this.err = await savePop(this.projectName, edited);
  }

  private renderProjectSelect() {
    const names = vault.snap.projects.map(project => project.name).sort((a: string, b: string) => a.localeCompare(b));
    return html`<label class=${fieldLabel}
      >${t("pop.project")}
      <select
        class="field"
        @change=${(e: Event) => {
          this.projectName = (e.target as HTMLSelectElement).value || null;
        }}
      >
        <option value="" .selected=${!this.projectName}>${t("general")}</option>
        ${names.map((name: string) => html`<option .selected=${name === this.projectName}>${name}</option>`)}
      </select></label
    >`;
  }

  // the sidebar entry of the project: its image or emoji, and its label
  private renderIconFields(current: string) {
    return html`<div class=${fieldLabel}>
      ${t("pop.sidebar", { name: current })}
      <div class="flex gap-2 items-center">
        <label class="btn inline-flex items-center flex-none" title=${t("pop.imgPick")}
          >${isImg(this.img) ? iconImg(this.img, "w-4 h-4 flex-none object-contain rounded-xs") : t("pop.img")}<input
            type="file"
            accept="image/*,.ico,.svg"
            hidden
            @change=${this.pickFile}
        /></label>
        <input
          class="field w-16 text-center placeholder:text-secondary"
          maxlength="4"
          placeholder="Emoji"
          .value=${live(this.emoji)}
          @input=${(e: Event) => {
            this.emoji = (e.target as HTMLInputElement).value;
            this.img = undefined;
          }}
        />
        <input
          class="field flex-1 min-w-0 placeholder:text-secondary"
          placeholder=${current}
          .value=${live(this.label)}
          @input=${(e: Event) => {
            this.label = (e.target as HTMLInputElement).value;
          }}
        />
      </div>
    </div>`;
  }

  override render() {
    const current = selectedProject();
    return html`<div class="grid grid-cols-1 gap-3 bg-bg border border-separator rounded-lg shadow-lg p-3.5">
      ${this.err ? html`<div class="err-box">${this.err}</div>` : nothing} ${this.renderProjectSelect()}
      ${current ? this.renderIconFields(current) : nothing}
      <div>
        <button class="btn" @click=${closeProjectPanel}>${t("pop.cancel")}</button
        ><button class="btn btn-primary" @click=${() => this.save()}>${t("pop.save")}</button>
      </div>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-project-panel": ProjectPanel;
  }
}
