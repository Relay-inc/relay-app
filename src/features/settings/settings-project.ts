import { html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { emit } from "../../core/dom";
import { t } from "../../core/i18n";
import type { ProjectIcon } from "../../domain/icons";
import {
  buttonClass,
  BUTTON_GLYPH,
  appIcon,
  field,
  FIELD,
  FIELD_CHIP,
  FIELD_ICON,
  inputValue,
  projectIcon,
} from "./blocks";
import { SettingsElement } from "./settings-element";
import { tws } from "./styles";

declare global {
  interface HTMLElementTagNameMap {
    "relay-settings-project": SettingsProject;
  }
  interface HTMLElementEventMap {
    "label-change": CustomEvent<string>;
    "icon-text": CustomEvent<string>;
    "icon-file": CustomEvent<File>;
    "icon-none": CustomEvent<void>;
    "icon-reset": CustomEvent<void>;
    "repos-change": CustomEvent<string[]>;
  }
}

/** One project's settings, in its folded-open row: the name in Relay, its icon on one line (tile, emoji or website, and
 *  small buttons) and its repos as removable chips. */
@customElement("relay-settings-project")
export class SettingsProject extends SettingsElement {
  static override styles = [tws];

  /** The name in the vault, which the field falls back to */
  @property() name = "";
  @property() label = "";
  @property({ attribute: false }) icon?: ProjectIcon;
  /** What the icon input shows: the emoji or the website */
  @property() iconText = "";
  @property() iconHint = "";
  @property({ attribute: false }) repos: string[] = [];

  private onIconFile = (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) emit(this, "icon-file", file);
  };

  private onNewRepo = (e: Event) => {
    const repo = inputValue(e).trim();
    if (repo) emit(this, "repos-change", [...this.repos, repo]);
  };

  private renderName() {
    const input = html`<input
      class=${FIELD}
      .value=${live(this.label)}
      placeholder=${this.name}
      spellcheck="false"
      @change=${(e: Event) => emit(this, "label-change", inputValue(e).trim())}
    />`;
    return field(t("pc.name"), input);
  }

  private renderIcon() {
    const controls = html`<span class="flex items-center gap-1.5"
      ><span class="grid size-7 flex-none place-items-center rounded-md border border-s-border"
        >${projectIcon(this.icon, "tile")}</span
      ><input
        class=${FIELD_ICON}
        .value=${live(this.iconText)}
        placeholder=${t("pc.iconPh")}
        spellcheck="false"
        @change=${(e: Event) => emit(this, "icon-text", inputValue(e).trim())}
      />
      <label class=${buttonClass("plain", true)} title=${t("pi.upload")}
        >${appIcon("upload", BUTTON_GLYPH)}<input
          type="file"
          accept="image/*,.ico,.svg"
          hidden
          @change=${this.onIconFile}
      /></label>
      <button class=${buttonClass("plain", true)} @click=${() => emit(this, "icon-none")} title=${t("pi.none")}>
        ${appIcon("none", BUTTON_GLYPH)}
      </button>
      <button class=${buttonClass("plain", true)} @click=${() => emit(this, "icon-reset")} title=${t("pi.reset")}>
        ${appIcon("refresh", BUTTON_GLYPH)}
      </button></span
    >`;
    return field(t("pc.icon"), controls, { hint: this.iconHint });
  }

  private renderRepoChip(repo: string) {
    const withoutRepo = this.repos.filter(x => x !== repo);
    return html`<span
      class="inline-flex h-6 items-center gap-1 rounded-full border border-s-border pr-1 pl-2 font-mono text-xs text-s-muted"
      >${repo}<button
        class="grid size-4 place-items-center rounded-full text-s-subtle hover:bg-s-hover hover:text-s-fg"
        @click=${() => emit(this, "repos-change", withoutRepo)}
        title=${t("ag.remove")}
      >
        ×
      </button></span
    >`;
  }

  private renderRepos() {
    const chips = html`<span class="flex max-w-xs flex-wrap justify-end gap-1.5"
      >${this.repos.map(repo => this.renderRepoChip(repo))}
      <input
        class=${FIELD_CHIP}
        .value=${live("")}
        placeholder="owner/repo"
        spellcheck="false"
        @change=${this.onNewRepo}
    /></span>`;
    return field(t("pc.repos"), chips, { hint: t("pc.reposHelp") });
  }

  override render() {
    return html`${this.renderName()} ${this.renderIcon()} ${this.renderRepos()}`;
  }
}
