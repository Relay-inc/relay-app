import { html, nothing } from "lit";
import { ifDefined } from "lit/directives/if-defined.js";
import { customElement, property, state } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { emit } from "../../core/dom";
import { pt, pth, t, th } from "../../core/i18n";
import type { BoardOpt, BoardProvider } from "../../domain/providers";
import {
  appIcon,
  BUTTON_GLYPH,
  OPTIONAL_TEXT,
  section,
  buttonClass,
  ERROR_MESSAGE,
  field,
  FIELD,
  HINT_IN_ROW,
  withoutColon,
  SELECT,
  STATUS_TEXT,
  toggleSwitch,
  inputValue,
  formText,
  removeFooter,
} from "./blocks";
import "./settings-menu";
import { matchBoard } from "./board-match";
import type { BoardLink } from "./board-controller";
import { SettingsElement } from "./settings-element";
import { contents, tws } from "./styles";
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
    "board-map": CustomEvent<BoardLink[]>;
    "boards-load": CustomEvent<void>;
  }
}

type ProviderField = BoardProvider["settings"]["fields"][number];

/** A vault project in the board mapping: the board of this provider it is on, or the other provider it is on */
export type BoardRow = { vaultProject: string; board?: string; other?: string };

/** A board provider's page in Integrations: the connection (token, the fields of its config), its boards per vault project. */
@customElement("relay-settings-board")
export class SettingsBoard extends SettingsElement {
  // its sections sit in the page's column, like the page's own
  static override styles = [tws, contents];

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
  // the row that adds a link: what is picked so far
  @state() private addProject = "";
  @state() private addBoard = "";

  override updated() {
    if (this.wantBoards && !this.boards) emit(this, "boards-load");
  }

  // kept here too, so what depends on a typed value (the token button) follows while typing
  private onField = (id: string) => (e: Event) => {
    const value = inputValue(e);
    this.form = { ...this.form, [id]: value };
    emit(this, "board-field", { id, value });
  };

  private link(links: BoardLink[]) {
    emit(this, "board-map", links);
  }
  // the boards under their workspace, so a picked board shows its own name
  private boardOptions(list: BoardOpt[], selected?: string) {
    const groups = [...new Set(list.map(board => board.group))];
    return groups.map(
      group =>
        html`<optgroup label=${group}>
          ${list
            .filter(board => board.group === group)
            .map(
              board =>
                html`<option value="${board.project}/${board.id}" ?selected=${selected === board.id}>
                  ${board.name}
                </option>`,
            )}
        </optgroup>`,
    );
  }

  // a linked vault project: its board, to change, and unlink
  private renderLinked(row: BoardRow, list: BoardOpt[]) {
    const vaultProject = row.vaultProject;
    const select = html`<select
      class=${SELECT}
      aria-label=${vaultProject}
      @change=${(e: Event) => this.link([{ vaultProject, value: inputValue(e) }])}
    >
      ${this.boardOptions(list, row.board)}
    </select>`;
    const unlink = html`<button
      class=${buttonClass("ghost", true)}
      title=${t("int.unlink")}
      aria-label=${t("int.unlink")}
      @click=${() => this.link([{ vaultProject, value: "" }])}
    >
      ${appIcon("close", BUTTON_GLYPH)}
    </button>`;
    return field(vaultProject, html`${select}${unlink}`);
  }

  // vault projects without a board whose name matches one: linked with one click, or all at once
  private renderSuggestions(free: BoardRow[], list: BoardOpt[]) {
    const suggestions = free
      .map(row => ({ row, board: matchBoard(row.vaultProject, list) }))
      .filter((match): match is { row: BoardRow; board: BoardOpt } => !!match.board);
    if (!suggestions.length) return nothing;
    const links = suggestions.map(({ row, board }) => ({
      vaultProject: row.vaultProject,
      value: `${board.project}/${board.id}`,
    }));
    const linkAll =
      links.length > 1
        ? html`<button class=${buttonClass("ghost")} @click=${() => this.link(links)}>${t("int.linkAll")}</button>`
        : nothing;
    return html`<div class="grid grid-cols-1 gap-1.5 border-t border-s-border pt-3">
      <div class="flex items-center justify-between gap-2">
        <b class="text-xs font-semibold">${t("int.suggested")}</b>${linkAll}
      </div>
      ${suggestions.map(
        ({ row, board }, i) =>
          html`<div class="flex items-center gap-2 text-sm">
            <span class="min-w-0 flex-1 truncate"
              >${row.vaultProject} <span class="text-s-faint">→ ${board.name} · ${board.group}</span>${
                row.other
                  ? html` <span class=${OPTIONAL_TEXT}>(${t("int.nowOn", { name: row.other })})</span>`
                  : nothing
              }</span
            ><button class=${buttonClass()} @click=${() => this.link([links[i]])}>${t("int.link")}</button>
          </div>`,
      )}
    </div>`;
  }

  // one more: a vault project and a board, then Link
  private renderAdd(free: BoardRow[], list: BoardOpt[]) {
    if (!free.length) return nothing;
    const project = free.some(row => row.vaultProject === this.addProject) ? this.addProject : "";
    const board = list.some(x => `${x.project}/${x.id}` === this.addBoard) ? this.addBoard : "";
    const add = () => {
      this.link([{ vaultProject: project, value: board }]);
      this.addProject = "";
      this.addBoard = "";
    };
    return html`<div class="flex flex-wrap items-center gap-2 border-t border-s-border pt-3">
      <select
        class="${SELECT} w-44!"
        aria-label=${t("int.pickProject")}
        @change=${(e: Event) => (this.addProject = inputValue(e))}
      >
        <option value="" ?selected=${!project}>${t("int.pickProject")}</option>
        ${free.map(
          row =>
            html`<option value=${row.vaultProject} ?selected=${row.vaultProject === project}>
              ${row.other ? `${row.vaultProject} (${row.other})` : row.vaultProject}
            </option>`,
        )}
      </select>
      <span class="text-s-faint">→</span>
      <select
        class="${SELECT} min-w-0 flex-1"
        aria-label=${t("int.pickBoard")}
        @change=${(e: Event) => (this.addBoard = inputValue(e))}
      >
        <option value="" ?selected=${!board}>${t("int.pickBoard")}</option>
        ${this.boardOptions(list, board.split("/")[1])}
      </select>
      <button class=${buttonClass()} ?disabled=${!project || !board} @click=${add}>${t("int.link")}</button>
    </div>`;
  }

  // which board a vault project opens: the linked ones, suggestions by name, and a row to add one
  private renderBoards() {
    const boards = this.boards;
    if (!this.wantBoards || !boards) return nothing;
    let body: unknown;
    if (!boards.list) body = html`<div class=${HINT_IN_ROW}>${t("pr.loading")}</div>`;
    else if (boards.err) body = html`<span class=${ERROR_MESSAGE}>${boards.err}</span>`;
    else {
      const list = boards.list;
      const linked = this.rows.filter(row => row.board);
      const free = this.rows.filter(row => !row.board);
      body = html`${
        linked.length
          ? linked.map(row => this.renderLinked(row, list))
          : html`<div class=${HINT_IN_ROW}>${t("int.noLinks")}</div>`
      }
      ${this.renderSuggestions(free, list)} ${this.renderAdd(free, list)}`;
    }
    return section(t("int.boards"), body, { desc: th("int.boardsHelp") });
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
    const buttons = html`${this.renderMore()}${save}`;
    return removeFooter(() => emit(this, "int-remove"), message ? message.text : "", !!message?.ok, buttons);
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
    const connection = html`${this.renderFoundInClaude()}
      <p class="${HINT_IN_ROW} [&_a]:underline">${pth(provider, provider.settings.help)}</p>
      ${secrets.map(fieldConfig => this.renderProviderField(fieldConfig))}
      ${field(withoutColon(pt(provider, provider.settings.tokenLabel)), tokenInput, { id: tokenId })}
      ${rest.map(fieldConfig => this.renderProviderField(fieldConfig))} ${this.renderFooter()}`;
    return html`${section(t("int.connection"), connection)} ${this.renderBoards()}`;
  }
}
