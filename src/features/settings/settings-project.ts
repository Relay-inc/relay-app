import { html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { emit } from "../../core/dom";
import { t } from "../../core/i18n";
import type { ProjectIcon } from "../../domain/icons";
import { btn, field, FIELD, FIELD_CHIP, FIELD_ICON, IB, ic, projectIcon, val } from "./blocks";
import { SettingsElement } from "./settings-element";
import { tws } from "./styles";

declare global {
  interface HTMLElementTagNameMap { "relay-settings-project": SettingsProject }
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
  static styles = [tws];

  /** The name in the vault, which the field falls back to */
  @property() name = "";
  @property() label = "";
  @property({ attribute: false }) icon?: ProjectIcon;
  /** What the icon input shows: the emoji or the website */
  @property() iconText = "";
  @property() iconHint = "";
  @property({ attribute: false }) repos: string[] = [];

  render() {
    const { repos } = this;
    return html`${field(t("pc.name"), html`<input class=${FIELD} .value=${live(this.label)} placeholder=${this.name} spellcheck="false" @change=${(e: Event) => emit(this, "label-change", val(e).trim())}>`)}
      ${field(t("pc.icon"), html`<span class="flex items-center gap-1.5"><span class="grid size-7 flex-none place-items-center rounded-[6px] border border-s-border">${projectIcon(this.icon, "tile")}</span><input class=${FIELD_ICON} .value=${live(this.iconText)} placeholder=${t("pc.iconPh")} spellcheck="false"
            @change=${(e: Event) => emit(this, "icon-text", val(e).trim())}>
          <label class=${btn("plain", true)} title=${t("pi.upload")}>${ic("upload", IB)}<input type="file" accept="image/*,.ico,.svg" hidden @change=${(e: Event) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) emit(this, "icon-file", f); }}></label>
          <button class=${btn("plain", true)} @click=${() => emit(this, "icon-none")} title=${t("pi.none")}>${ic("none", IB)}</button>
          <button class=${btn("plain", true)} @click=${() => emit(this, "icon-reset")} title=${t("pi.reset")}>${ic("refresh", IB)}</button></span>`, { hint: this.iconHint })}
      ${field(t("pc.repos"), html`<span class="flex max-w-[340px] flex-wrap justify-end gap-1.5">${repos.map(r => html`<span class="inline-flex h-6 items-center gap-1 rounded-full border border-s-border pr-1 pl-2 font-mono text-xs text-s-muted">${r}<button class="grid size-4 place-items-center rounded-full text-s-subtle hover:bg-s-hover hover:text-s-fg" @click=${() => emit(this, "repos-change", repos.filter(x => x !== r))} title=${t("ag.remove")}>×</button></span>`)}
          <input class=${FIELD_CHIP} .value=${live("")} placeholder="owner/repo" spellcheck="false" @change=${(e: Event) => { const x = val(e).trim(); if (x) emit(this, "repos-change", [...repos, x]); }}></span>`, { hint: t("pc.reposHelp") })}`;
  }
}
