import { html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "../../core/dom";
import { glyphSvg } from "../../core/icons";
import { t, th } from "../../core/i18n";
import { PROVIDERS, provider as providerById, type BoardProvider } from "../../domain/providers";
import { BoardsController } from "./board-controller";
import { buttonClass, BUTTON_GLYPH, footer, appIcon, EMPTY_LIST, formText, section, statusLine, TILE } from "./blocks";
import { MailController } from "./mail-controller";
import "./settings-board";
import "./settings-fold";
import "./settings-github";
import "./settings-mail";
import "./settings-menu";
import type { BoardRow } from "./settings-board";
import type { BoardLink } from "./board-controller";
import { SettingsElement } from "./settings-element";
import { page, tws } from "./styles";
import type { Settings } from "./types";

declare global {
  interface HTMLElementTagNameMap {
    "relay-settings-integrations": SettingsIntegrations;
  }
}

// a provider's 16×16 glyph on the 24×24 tile
const providerIcon = (provider: BoardProvider) =>
  glyphSvg(`<g transform="scale(1.5)">${provider.glyph}</g>`, TILE, "0 0 24 24");

type Entry = {
  id: string;
  icon: unknown;
  name: unknown;
  status: unknown;
  on: boolean;
  /** its page: sections of its own (a board provider), or one body that goes in a card */
  page: () => unknown;
};

/** Integrations: the ones in use are listed (a board provider set up or added, GitHub and Mail switched on), the others
 *  are in the Add menu. In the list means in the sidebar; a row opens the integration's own page, Remove switches it off
 *  and keeps the token. The state of every integration lives here, so it survives going back to the list. */
@customElement("relay-settings-integrations")
export class SettingsIntegrations extends SettingsElement {
  static override styles = [tws, page];

  @property({ type: Boolean, reflect: true }) active = false;
  @property({ attribute: false }) settings!: Settings;
  @state() private loaded = false;
  // text inputs that are only read on Save (token, board fields, GitHub owners), by id; unsaved edits stay until then
  private form: Record<string, string | boolean> = {};
  private boards = new BoardsController(this, this.form);
  private mail = new MailController(this);
  // GitHub: no token of our own, the app uses gh's login. The status is the account gh is signed in with
  @state() private githubLogin = "";
  @state() private githubError = "";
  @state() private githubMessage = "";
  @state() private githubOk = false;
  @state() private listMessage = "";
  @state() private listOk = false;
  // the integration whose page is open, or null for the list
  @state() private detail: string | null = null;

  override connectedCallback() {
    super.connectedCallback();
    this.mail.load();
    this.boards.loadTokens().then(() => {
      this.loaded = true;
    });
    this.checkGithub();
  }
  override willUpdate() {
    if (this.active) this.boards.askMcp();
  }

  /** A change to the settings made here: kept, and reported to the window */
  commit(settings: Settings) {
    this.settings = settings;
    emit(this, "settings-changed", settings);
  }

  private onBoardField = (e: CustomEvent<{ id: string; value: string | boolean }>) => {
    this.form[e.detail.id] = e.detail.value;
  };

  private githubStatus() {
    if (this.githubLogin) return statusLine("ok", t("gh.connected", { login: this.githubLogin }));
    return statusLine(this.githubError ? "warn" : "off", this.githubError || t("gh.checking"));
  }
  private mailStatus() {
    const count = this.mail.edit.accounts.length;
    return statusLine(count ? "ok" : "off", t("mail.accounts", { n: count }));
  }
  private boardStatus(provider: BoardProvider) {
    const isSetUp = this.boards.setUp(provider);
    if (!isSetUp && this.boards.mcp[provider.id]?.found) return statusLine("warn", t("int.foundClaude"));
    return statusLine(isSetUp ? "ok" : "off", isSetUp ? t("int.set") : t("int.notSet"));
  }
  private isBoardOn(provider: BoardProvider) {
    const on = this.settings.integrations[provider.id]?.on;
    return on === true || (on === undefined && !!this.boards.setUp(provider));
  }

  private setOpen(id: string, open: boolean) {
    this.detail = open ? id : null;
  }

  private settingsWithOn(id: string, on: boolean): Settings {
    const next = structuredClone(this.settings);
    if (id === "github") next.github.on = on;
    else if (id === "mail") next.mail = { ...next.mail, on };
    else next.integrations[id] = { ...next.integrations[id], on };
    return next;
  }

  // an integration in or out of the list: on for the sidebar, a board provider's token stays in the keychain
  private async switchTo(id: string, on: boolean) {
    this.setOpen(id, on);
    try {
      this.commit(await invoke<Settings>("set_settings", { settings: this.settingsWithOn(id, on) }));
      if (id === "mail") this.mail.edit.on = on;
      this.listMessage = "";
      this.listOk = true;
    } catch (error) {
      this.listMessage = String(error);
      this.listOk = false;
    }
  }

  private async saveGithub() {
    const owners = formText(this.form, "ghowners", this.settings.github.owners).trim();
    const next = { ...this.settings, github: { ...this.settings.github, owners } };
    try {
      this.commit(await invoke<Settings>("set_settings", { settings: next }));
      delete this.form.ghowners;
      this.githubMessage = t("set.saved");
      this.githubOk = true;
    } catch (error) {
      this.githubMessage = String(error);
      this.githubOk = false;
    }
  }
  private async checkGithub() {
    this.githubLogin = "";
    this.githubError = "";
    try {
      this.githubLogin = await invoke<string>("github_status");
    } catch (error) {
      this.githubError = String(error);
    }
  }

  // each vault project with the board of this provider it is on; a vault project has at most one board
  private boardRows(provider: BoardProvider): BoardRow[] {
    return (this.boards.vaultProjects || []).map(vaultProject => {
      const current = this.settings.boards?.[vaultProject];
      const isOurs = current?.provider === provider.id;
      const otherProvider = current ? (providerById(current.provider)?.name ?? current.provider) : "";
      return {
        vaultProject,
        board: isOurs ? current.board : undefined,
        other: current && !isOurs ? otherProvider : undefined,
      };
    });
  }

  private boardBody(provider: BoardProvider) {
    const boards = this.boards;
    const id = provider.id;
    return html`<relay-settings-board
      .provider=${provider}
      .config=${this.settings.integrations[id] || {}}
      .hasToken=${!!boards.tokens[id]}
      .form=${{ ...this.form }}
      .mcp=${boards.mcp[id]}
      .setUp=${!!boards.setUp(provider)}
      .message=${boards.messages[id]}
      .wantBoards=${!!provider.settings.allBoards && !!boards.setUp(provider)}
      .boards=${boards.all[id]}
      .rows=${this.boardRows(provider)}
      @board-field=${this.onBoardField}
      @board-save=${() => boards.saveForm(provider)}
      @board-import=${() => boards.import(provider)}
      @board-clear=${() => boards.clear(provider)}
      @board-map=${(e: CustomEvent<BoardLink[]>) => boards.map(provider, e.detail)}
      @boards-load=${() => {
        if (!boards.all[id]) boards.load(provider);
      }}
    ></relay-settings-board>`;
  }
  private githubBody() {
    return html`<relay-settings-github
      .owners=${formText(this.form, "ghowners", this.settings.github.owners)}
      .message=${this.githubMessage}
      ?ok=${this.githubOk}
      @owners-input=${(e: CustomEvent<string>) => {
        this.form.ghowners = e.detail;
      }}
      @gh-recheck=${() => this.checkGithub()}
      @gh-save=${() => this.saveGithub()}
    ></relay-settings-github>`;
  }
  private mailBody() {
    const mail = this.mail;
    return html`<relay-settings-mail
      .config=${{ ...mail.edit }}
      .newAccount=${{ ...mail.newAccount }}
      .tests=${{ ...mail.tests }}
      .busy=${mail.busy}
      .message=${mail.message}
      ?ok=${mail.ok}
      @mail-new=${(e: CustomEvent<{ key: keyof typeof mail.newAccount; value: string }>) => {
        mail.newAccount[e.detail.key] = e.detail.value;
      }}
      @mail-account=${(e: CustomEvent<string>) => {
        mail.edit.account = e.detail;
      }}
      @mail-experimental=${(e: CustomEvent<boolean>) => {
        mail.edit.experimental = e.detail;
        this.requestUpdate();
      }}
      @mail-test=${(e: CustomEvent) => mail.test(e.detail)}
      @mail-drop=${(e: CustomEvent) => mail.drop(e.detail)}
      @mail-connect=${() => mail.connect()}
      @mail-add=${() => mail.add()}
      @mail-save=${() => mail.save()}
    ></relay-settings-mail>`;
  }

  private entries(): Entry[] {
    const boardEntries = PROVIDERS.map(provider => ({
      id: provider.id,
      icon: providerIcon(provider),
      name: provider.name,
      status: this.boardStatus(provider),
      on: this.isBoardOn(provider),
      page: () => this.boardBody(provider),
    }));
    return [
      ...boardEntries,
      {
        id: "github",
        icon: appIcon("gh", TILE),
        name: "GitHub",
        status: this.githubStatus(),
        on: !!this.settings.github.on,
        page: () => section(t("int.connection"), this.githubBody()),
      },
      {
        id: "mail",
        icon: appIcon("mail", TILE),
        name: "Mail",
        status: this.mailStatus(),
        on: !!this.settings.mail?.on,
        page: () => section(t("int.connection"), this.mailBody()),
      },
    ];
  }

  private renderEntry(entry: Entry) {
    return html`<relay-settings-fold
      nav
      .icon=${entry.icon}
      .name=${entry.name}
      .status=${entry.status}
      @fold-toggle=${() => this.setOpen(entry.id, true)}
    ></relay-settings-fold>`;
  }

  // an integration's own page: back to the list, its name and status, then its sections
  private renderDetail(entry: Entry) {
    return html`<header class="grid gap-3">
        <button class="${buttonClass("ghost")} -ml-2 justify-self-start" @click=${() => this.setOpen(entry.id, false)}>
          ${appIcon("left", BUTTON_GLYPH)}${t("set.tab.integrations")}
        </button>
        <div class="flex items-center gap-3">
          <span class="grid size-9 flex-none place-items-center rounded-lg border border-s-border bg-s-bg"
            >${entry.icon}</span
          >
          <div class="min-w-0">
            <h1 class="text-base font-semibold text-s-fg">${entry.name}</h1>
            <div class="mt-px flex">${entry.status}</div>
          </div>
        </div>
      </header>
      ${entry.page()}`;
  }

  private renderAddMenu(unused: Entry[]) {
    const items = unused.map(({ id, icon, name, status }) => ({ id, icon, name, status }));
    return html`<relay-settings-menu
      .label=${t("int.add")}
      .items=${items}
      @menu-pick=${(e: CustomEvent<string>) => this.switchTo(e.detail, true)}
    ></relay-settings-menu>`;
  }

  override render() {
    if (!this.loaded) return nothing;
    const entries = this.entries();
    const open = entries.find(entry => entry.id === this.detail && entry.on);
    if (open) return this.renderDetail(open);
    const listed = entries.filter(entry => entry.on);
    const rows = listed.length
      ? listed.map(entry => this.renderEntry(entry))
      : html`<div class=${EMPTY_LIST}>${t("int.empty")}</div>`;
    return section(t("set.tab.integrations"), rows, {
      desc: th("int.listHelp"),
      list: true,
      footer: this.listMessage ? footer(this.listMessage, this.listOk, nothing) : nothing,
      action: this.renderAddMenu(entries.filter(entry => !entry.on)),
    });
  }
}
