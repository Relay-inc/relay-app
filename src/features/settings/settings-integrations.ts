import { html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "../../core/dom";
import { glyphSvg } from "../../core/icons";
import { t, th } from "../../core/i18n";
import { PROVIDERS, provider, type BoardProvider } from "../../domain/providers";
import { BoardsController } from "./board-controller";
import { foot, ic, SEMPTY, sec, st, TILE } from "./blocks";
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

declare global { interface HTMLElementTagNameMap { "relay-settings-integrations": SettingsIntegrations } }

// a provider's 16×16 glyph on the 24×24 tile
const pIcon = (p: BoardProvider) => glyphSvg(`<g transform="scale(1.5)">${p.glyph}</g>`, TILE, "0 0 24 24");

type Entry = { id: string; ico: unknown; name: unknown; state: unknown; on: boolean; body: () => unknown };

/** Integrations: the ones in use are listed (a board provider set up or added, GitHub and Mail switched on), the others
 *  are in the Add menu. In the list means in the sidebar; Remove switches it off and keeps the token. The state of every
 *  integration lives here, not in its row, so it survives the row folding shut. */
@customElement("relay-settings-integrations")
export class SettingsIntegrations extends SettingsElement {
  static styles = [tws, page];

  @property({ type: Boolean, reflect: true }) active = false;
  @property({ attribute: false }) settings!: Settings;
  @state() private loaded = false;
  // text inputs that are only read on Save (token, board fields, GitHub owners), by id; unsaved edits stay until then
  private form: Record<string, string | boolean> = {};
  private boards = new BoardsController(this, this.form);
  private mail = new MailController(this);
  // GitHub: no token of our own, the app uses gh's login. The status is the account gh is signed in with
  @state() private ghLogin = ""; @state() private ghErr = ""; @state() private ghMsg = ""; @state() private ghOk = false;
  @state() private intMsg = ""; @state() private intOk = false;
  // which rows are folded open
  private opened = new Set<string>();

  connectedCallback() {
    super.connectedCallback();
    this.mail.load();
    this.boards.loadTokens().then(() => { this.loaded = true; });
    this.ghCheck();
  }
  willUpdate() { if (this.active) this.boards.askMcp(); }

  /** A change to the settings made here: kept, and reported to the window */
  commit(s: Settings) { this.settings = s; emit(this, "settings-changed", s); }

  private fstr(id: string, d: unknown = "") { const v = this.form[id]; return typeof v === "string" ? v : String(d ?? ""); }
  private field = (e: CustomEvent<{ id: string; value: string | boolean }>) => { this.form[e.detail.id] = e.detail.value; };

  private ghState() { return st(this.ghLogin ? "ok" : this.ghErr ? "warn" : "off", this.ghLogin ? t("gh.connected", { login: this.ghLogin }) : this.ghErr || t("gh.checking")); }
  private mailState() { return st(this.mail.edit.accounts.length ? "ok" : "off", t("mail.accounts", { n: this.mail.edit.accounts.length })); }
  private boardState(p: BoardProvider) { const set = this.boards.setUp(p); return !set && this.boards.mcp[p.id]?.found ? st("warn", t("int.foundClaude")) : st(set ? "ok" : "off", set ? t("int.set") : t("int.notSet")); }
  private boardOn(p: BoardProvider) { const on = this.settings.integrations[p.id]?.on; return on === true || (on === undefined && !!this.boards.setUp(p)); }

  // an integration in or out of the list: on for the sidebar, a board provider's token stays in the keychain
  private async switchTo(id: string, on: boolean) {
    if (on) this.opened.add(id); else this.opened.delete(id);
    const next = structuredClone(this.settings);
    if (id === "github") next.github.on = on;
    else if (id === "mail") next.mail = { ...next.mail, on };
    else next.integrations[id] = { ...next.integrations[id], on };
    try { this.commit(await invoke<Settings>("set_settings", { settings: next })); if (id === "mail") this.mail.edit.on = on; this.intMsg = ""; this.intOk = true; }
    catch (x) { this.intMsg = String(x); this.intOk = false; }
    this.requestUpdate();
  }

  private async ghSave() {
    const next = { ...this.settings, github: { ...this.settings.github, owners: this.fstr("ghowners", this.settings.github.owners).trim() } };
    try { this.commit(await invoke<Settings>("set_settings", { settings: next })); delete this.form.ghowners; this.ghMsg = t("set.saved"); this.ghOk = true; }
    catch (x) { this.ghMsg = String(x); this.ghOk = false; }
  }
  private async ghCheck() {
    this.ghLogin = ""; this.ghErr = "";
    try { this.ghLogin = await invoke<string>("github_status"); } catch (e) { this.ghErr = String(e); }
  }

  private boardBody(p: BoardProvider) {
    const b = this.boards, want = !!p.settings.allBoards && !!b.setUp(p);
    const rows: BoardRow[] = (b.vaultProjects || []).map(vp => { const cur = this.settings.boards?.[vp], mine = cur?.provider === p.id;
      return { vp, none: mine || !cur ? t("kb.linkNone") : provider(cur.provider)?.name ?? cur.provider, board: mine ? cur.board : undefined }; });
    return html`<relay-settings-board .provider=${p} .cfg=${this.settings.integrations[p.id] || {}} .hasToken=${!!b.tokens[p.id]} .form=${{ ...this.form }} .mcp=${b.mcp[p.id]}
      .setUp=${!!b.setUp(p)} .msg=${b.msgs[p.id]} .wantBoards=${want} .boards=${b.all[p.id]} .rows=${rows}
      @board-field=${this.field} @board-save=${() => b.saveForm(p)} @board-import=${() => b.import(p)} @board-clear=${() => b.clear(p)}
      @board-map=${(e: CustomEvent<{ vp: string; value: string }>) => b.map(p, e.detail.vp, e.detail.value)} @boards-load=${() => { if (!b.all[p.id]) b.load(p); }}></relay-settings-board>`;
  }
  private githubBody() {
    return html`<relay-settings-github .owners=${this.fstr("ghowners", this.settings.github.owners)} .msg=${this.ghMsg} ?ok=${this.ghOk}
      @owners-input=${(e: CustomEvent<string>) => { this.form.ghowners = e.detail; }} @gh-recheck=${() => this.ghCheck()} @gh-save=${() => this.ghSave()}></relay-settings-github>`;
  }
  private mailBody() {
    const m = this.mail;
    return html`<relay-settings-mail .cfg=${{ ...m.edit }} .fresh=${{ ...m.fresh }} .tests=${{ ...m.tests }} .busy=${m.busy} .msg=${m.msg} ?ok=${m.ok}
      @mail-new=${(e: CustomEvent<{ key: keyof typeof m.fresh; value: string }>) => { m.fresh[e.detail.key] = e.detail.value; }}
      @mail-account=${(e: CustomEvent<string>) => { m.edit.account = e.detail; }} @mail-test=${(e: CustomEvent) => m.test(e.detail)} @mail-drop=${(e: CustomEvent) => m.drop(e.detail)}
      @mail-connect=${() => m.connect()} @mail-add=${() => m.add()} @mail-save=${() => m.save()}></relay-settings-mail>`;
  }

  render() {
    if (!this.loaded) return nothing;
    const all: Entry[] = [
      ...PROVIDERS.map(p => ({ id: p.id, ico: pIcon(p), name: p.name, state: this.boardState(p), on: this.boardOn(p), body: () => this.boardBody(p) })),
      { id: "github", ico: ic("gh", TILE), name: "GitHub", state: this.ghState(), on: !!this.settings.github.on, body: () => this.githubBody() },
      { id: "mail", ico: ic("mail", TILE), name: "Mail", state: this.mailState(), on: !!this.settings.mail?.on, body: () => this.mailBody() },
    ];
    const act = all.filter(x => x.on);
    const row = (x: Entry) => html`<relay-settings-fold ?open=${this.opened.has(x.id)} .ico=${x.ico} .name=${x.name} .state=${x.state}
        @fold-toggle=${() => { if (!this.opened.delete(x.id)) this.opened.add(x.id); this.requestUpdate(); }} @int-remove=${() => this.switchTo(x.id, false)}>${this.opened.has(x.id) ? x.body() : nothing}</relay-settings-fold>`;
    return sec(t("set.tab.integrations"), act.length ? act.map(row) : html`<div class=${SEMPTY}>${t("int.empty")}</div>`,
      { desc: th("int.listHelp"), list: true, foot: this.intMsg ? foot(this.intMsg, this.intOk, nothing) : nothing,
        action: html`<relay-settings-menu .label=${t("int.add")} .items=${all.filter(x => !x.on).map(x => ({ id: x.id, ico: x.ico, name: x.name, state: x.state }))} @menu-pick=${(e: CustomEvent<string>) => this.switchTo(e.detail, true)}></relay-settings-menu>` });
  }
}
