import { html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "../../core/dom";
import { glyphSvg } from "../../core/icons";
import { t, th } from "../../core/i18n";
import { PROVIDERS, provider as providerById, type BoardProvider } from "../../domain/providers";
import { BoardsController } from "./board-controller";
import { footer, appIcon, EMPTY_LIST, formText, section, statusLine, TILE } from "./blocks";
import { MailController } from "./mail-controller";
import "./settings-board";
import "./settings-fold";
import "./settings-github";
import "./settings-mail";
import "./settings-menu";
import type { BoardRow } from "./settings-board";
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
  body: () => unknown;
};

/** Integrations: the ones in use are listed (a board provider set up or added, GitHub and Mail switched on), the others
 *  are in the Add menu. In the list means in the sidebar; Remove switches it off and keeps the token. The state of every
 *  integration lives here, not in its row, so it survives the row folding shut. */
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
  // which rows are folded open
  @state() private opened = new Set<string>();

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
    const opened = new Set(this.opened);
    if (open) opened.add(id);
    else opened.delete(id);
    this.opened = opened;
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
        noneLabel: isOurs || !current ? t("kb.linkNone") : otherProvider,
        board: isOurs ? current.board : undefined,
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
      @board-map=${(e: CustomEvent<{ vaultProject: string; value: string }>) =>
        boards.map(provider, e.detail.vaultProject, e.detail.value)}
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
      body: () => this.boardBody(provider),
    }));
    return [
      ...boardEntries,
      {
        id: "github",
        icon: appIcon("gh", TILE),
        name: "GitHub",
        status: this.githubStatus(),
        on: !!this.settings.github.on,
        body: () => this.githubBody(),
      },
      {
        id: "mail",
        icon: appIcon("mail", TILE),
        name: "Mail",
        status: this.mailStatus(),
        on: !!this.settings.mail?.on,
        body: () => this.mailBody(),
      },
    ];
  }

  private renderEntry(entry: Entry) {
    const open = this.opened.has(entry.id);
    return html`<relay-settings-fold
      ?open=${open}
      .icon=${entry.icon}
      .name=${entry.name}
      .status=${entry.status}
      @fold-toggle=${() => this.setOpen(entry.id, !open)}
      @int-remove=${() => this.switchTo(entry.id, false)}
      >${open ? entry.body() : nothing}</relay-settings-fold
    >`;
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
