import { html, nothing } from "lit";
import { ifDefined } from "lit/directives/if-defined.js";
import { customElement, property } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { emit } from "../../core/dom";
import { pt, pth, t, th } from "../../core/i18n";
import type { BoardOpt, BoardProvider } from "../../domain/providers";
import {
  buttonClass,
  ERROR_MESSAGE,
  field,
  FIELD,
  footer,
  FOOTER_IN_ROW,
  HINT,
  HINT_IN_ROW,
  withoutColon,
  SELECT,
  STATUS_TEXT,
  toggleSwitch,
  inputValue,
  formText,
} from "./blocks";
import "./settings-menu";
import { SettingsElement } from "./settings-element";
import { tws } from "./styles";
import type { Message } from "./types";
import type { IntegrationConfig } from "../../domain/config";

declare global {
  interface HTMLElementTagNameMap {
    "relay-settings-board": SettingsBoard;
  }
  interface HTMLElementEventMap {
    "board-field": CustomEvent<{ id: string; value: string | boolean }>;
    "board-save": CustomEvent<void>;
    "board-import": CustomEvent<void>;
    "board-clear": CustomEvent<void>;
    "board-map": CustomEvent<{ vaultProject: string; value: string }>;
    "boards-load": CustomEvent<void>;
  }
}

type ProviderField = BoardProvider["settings"]["fields"][number];

/** A vault project's row in the board mapping: what its "none" option says, and the board of this provider it is on */
export type BoardRow = { vaultProject: string; noneLabel: string; board?: string };

/** A board provider's body in the integrations list: the token, the fields of its config, its boards per vault project. */
@customElement("relay-settings-board")
export class SettingsBoard extends SettingsElement {
  static override styles = [tws];

  @property({ attribute: false }) provider!: BoardProvider;
  @property({ attribute: false }) config: IntegrationConfig = {};
  @property({ type: Boolean }) hasToken = false;
  /** The inputs read on Save, by id (the secrets, the fields); unsaved edits stay until then */
  @property({ attribute: false }) form: Record<string, string | boolean> = {};
  /** Can it take its credentials from Claude Code, and does Claude Code have them */
  @property({ attribute: false }) mcp?: { supported: boolean; found: boolean };
  @property({ type: Boolean }) setUp = false;
  @property({ attribute: false }) message?: Message;
  /** The provider lists all its boards in one call, and is set up: its boards map to the vault's projects */
  @property({ type: Boolean }) wantBoards = false;
  @property({ attribute: false }) boards?: { list: BoardOpt[] | null; err: string };
  @property({ attribute: false }) rows: BoardRow[] = [];

  override updated() {
    if (this.wantBoards && !this.boards) emit(this, "boards-load");
  }

  // kept here too, so what depends on a typed value (the token button) follows while typing
  private onField = (id: string) => (e: Event) => {
    const value = inputValue(e);
    this.form = { ...this.form, [id]: value };
    emit(this, "board-field", { id, value });
  };

  private renderBoardMapping(row: BoardRow, list: BoardOpt[]) {
    const options = list.map(
      board =>
        html`<option value="${board.project}/${board.id}" ?selected=${row.board === board.id}>
          ${board.group} › ${board.name}
        </option>`,
    );
    const select = html`<select
      class=${SELECT}
      @change=${(e: Event) => emit(this, "board-map", { vaultProject: row.vaultProject, value: inputValue(e) })}
    >
      <option value="">${row.noneLabel}</option>
      ${options}
    </select>`;
    return field(row.vaultProject, select);
  }

  // the provider's boards per vault project
  private renderBoards() {
    const boards = this.boards;
    if (!this.wantBoards || !boards) return nothing;
    if (!boards.list) return html`<div class=${HINT_IN_ROW}>${t("pr.loading")}</div>`;
    if (boards.err)
      return html`<div class="flex items-center gap-2"><span class=${ERROR_MESSAGE}>${boards.err}</span></div>`;
    const list = boards.list;
    return html`<div class="mt-2 grid gap-0.5 border-t border-s-border pt-3">
        <b class="text-xs font-semibold">${t("int.boards")}</b>
        <p class=${HINT}>${th("int.boardsHelp")}</p>
      </div>
      ${this.rows.map(row => this.renderBoardMapping(row, list))}`;
  }

  private get tokenPlaceholder() {
    return this.hasToken ? t("int.tokenStored") : t("int.tokenPaste");
  }

  private renderSwitchField(fieldConfig: ProviderField) {
    const id = `f-${this.provider.id}-${fieldConfig.key}`;
    const label = fieldConfig.placeholder
      ? pt(this.provider, fieldConfig.placeholder)
      : pt(this.provider, fieldConfig.label);
    const on = !!(this.form[id] ?? this.config[fieldConfig.key]);
    const toggle = toggleSwitch(id, on, e =>
      emit(this, "board-field", { id, value: (e.target as HTMLInputElement).checked }),
    );
    return field(label, toggle, { id });
  }

  private renderSecretInput(id: string) {
    return html`<input
      class=${FIELD}
      id=${id}
      type="password"
      autocomplete="off"
      placeholder=${this.tokenPlaceholder}
      .value=${live(formText(this.form, id))}
      @input=${this.onField(id)}
      spellcheck="false"
    />`;
  }

  private renderTextInput(id: string, fieldConfig: ProviderField) {
    const placeholder = fieldConfig.placeholder ? pt(this.provider, fieldConfig.placeholder) : undefined;
    return html`<input
      class=${FIELD}
      id=${id}
      inputmode=${fieldConfig.numeric ? "numeric" : nothing}
      .value=${live(formText(this.form, id, this.config[fieldConfig.key]))}
      @input=${this.onField(id)}
      placeholder=${ifDefined(placeholder)}
      spellcheck="false"
    />`;
  }

  // the button that opens the tracker's token page, when it has one; until then it says what is missing
  private renderTokenButton() {
    const provider = this.provider;
    const tokenUrl = provider.settings.tokenUrl;
    if (!tokenUrl) return nothing;
    const secrets = Object.fromEntries(
      provider.settings.fields
        .filter(fieldConfig => fieldConfig.secret)
        .map(fieldConfig => [fieldConfig.key, formText(this.form, `f-${provider.id}-${fieldConfig.key}`).trim()]),
    );
    const url = tokenUrl(secrets);
    const label = pt(provider, "getToken");
    // a link: the settings window opens https links in the browser
    if (url) return html`<a class="${buttonClass()} inline-flex items-center no-underline" href=${url}>${label}</a>`;
    return html`<button class=${buttonClass()} disabled title=${pt(provider, "needKey")}>${label}</button>`;
  }

  private renderProviderField(fieldConfig: ProviderField) {
    if (fieldConfig.check) return this.renderSwitchField(fieldConfig);
    const id = `f-${this.provider.id}-${fieldConfig.key}`;
    const input = fieldConfig.secret ? this.renderSecretInput(id) : this.renderTextInput(id, fieldConfig);
    return field(withoutColon(pt(this.provider, fieldConfig.label)), input, { id });
  }

  // the rarer actions behind "…": take the credentials from Claude Code, clear the token
  private renderMore() {
    const { mcp } = this;
    const items = [
      mcp?.supported
        ? {
            id: "import",
            name: t("int.importClaude"),
            status: html`<span class=${STATUS_TEXT}>${t(mcp.found ? "int.importFound" : "int.importNone")}</span>`,
          }
        : null,
      this.hasToken ? { id: "clear", name: t("int.clear") } : null,
    ].filter(x => x != null);
    if (!items.length) return nothing;
    return html`<relay-settings-menu
      up
      .tip=${t("int.more")}
      .items=${items}
      @menu-pick=${(e: CustomEvent<string>) => emit(this, e.detail === "import" ? "board-import" : "board-clear")}
    ></relay-settings-menu>`;
  }

  // Claude Code has credentials for this provider and it is not set up yet
  private renderFoundInClaude() {
    if (this.setUp || !this.mcp?.found) return nothing;
    return html`<div
      class="flex items-center gap-3 rounded-md border border-s-border bg-s-mutedbg/35 px-3 py-2.5 text-xs"
    >
      <span class="flex-1">${t("int.foundClaudeLong", { name: this.provider.name })}</span
      ><button class=${buttonClass("primary")} @click=${() => emit(this, "board-import")}>${t("int.import")}</button>
    </div>`;
  }

  private renderFooter() {
    const { message } = this;
    const save = html`<button class=${buttonClass("primary")} @click=${() => emit(this, "board-save")}>
      ${t("int.save")}
    </button>`;
    return html`<div class=${FOOTER_IN_ROW}>
      <button class=${buttonClass("ghost")} @click=${() => emit(this, "int-remove")}>${t("ag.remove")}</button
      >${this.renderMore()}${footer(message ? message.text : "", !!message?.ok, save)}
    </div>`;
  }

  override render() {
    const provider = this.provider;
    const tokenId = `tok-${provider.id}`;
    // the other secrets first: the token is the one you get with them (Trello: the API key, then its token)
    const fields = provider.settings.fields;
    const secrets = fields.filter(fieldConfig => fieldConfig.secret && !fieldConfig.check);
    const rest = fields.filter(fieldConfig => !secrets.includes(fieldConfig));
    const tokenInput = provider.settings.tokenUrl
      ? html`<div class="flex items-center gap-2">${this.renderSecretInput(tokenId)}${this.renderTokenButton()}</div>`
      : this.renderSecretInput(tokenId);
    return html`${this.renderFoundInClaude()}
      <p class="${HINT_IN_ROW} [&_a]:underline">${pth(provider, provider.settings.help)}</p>
      ${secrets.map(fieldConfig => this.renderProviderField(fieldConfig))}
      ${field(withoutColon(pt(provider, provider.settings.tokenLabel)), tokenInput, { id: tokenId })}
      ${rest.map(fieldConfig => this.renderProviderField(fieldConfig))} ${this.renderFooter()} ${this.renderBoards()}`;
  }
}
