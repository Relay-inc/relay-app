import { html, nothing } from "lit";
import { live } from "lit/directives/live.js";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { RelayElement, styles } from "../../lib/store";
import css from "./settings.css?inline";
import { currentLocale, initI18n, pt, pth, t, th, tn, at, ath } from "../../i18n";
import type { Key } from "../../locales/en";
import { PROVIDERS, provider, ctxOf, type BoardOpt, type BoardProvider, type BoardRef } from "../../providers";
import { agent, agentsStatus, type AgentsStatus, type AgentStatus } from "../../agents";
import { KEYS, pickVault, pickMapped, checkMapping, type VaultStatus, type VaultMap } from "../../vault-setup";
import { iconPaths, glyphSvg } from "../../icons";
import { loadIcons, setIcon, iconFrom, iconImg, isSite, type ProjectIcon, type IconKind } from "../../project-icons";

// The settings window, laid out like bb's: the pages in a sidebar on the left, the window title follows the page.
// General holds the vault folder with its mapping and the language, Projects the projects the user customised,
// Agents the coding-agent CLIs (src/agents/: switched on, the default, the program), Integrations the external services (the board providers
// from src/providers/, GitHub, Mail), one sidebar page each. Saving emits "settings-changed" from the backend, the main window follows it.
type MailAcct = { email: string; keychain_service: string; keychain_account: string };
type MailCfg = { on: boolean; account: string; accounts: MailAcct[] };
type Settings = { vault: string; vaults?: Record<string, VaultMap>; projects: Record<string, { icon?: string; img?: string; label?: string }>; overrides: Record<string, string | null>;
  integrations: Record<string, Record<string, any>>; boards: Record<string, BoardRef>; github: { on: boolean; owners: string }; mail: MailCfg; language?: string;
  favicons?: { on: boolean; last: string; tried: Record<string, string> };
  agents: { default: string; providers: Record<string, { on: boolean; bin: string; [opt: string]: unknown }> } };
type Tpl = unknown;
type Msg = { text: string; ok: boolean };

// GitHub's mark (octicon mark-github), in the label colour
const GH = '<path transform="translate(4 4)" fill="currentColor" stroke="none" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>';
const ic = (n: string) => glyphSvg(n === "gh" ? GH : iconPaths(n), "", "0 0 24 24");
// a provider's 16×16 glyph on the 24×24 tile
const pIcon = (p: BoardProvider) => glyphSvg(`<g transform="scale(1.5)">${p.glyph}</g>`, "", "0 0 24 24");
const agGlyph = (id: string) => { const ap = agent(id); return ap ? glyphSvg(ap.glyph, "", "0 0 16 16") : nothing; };
const TABS = [["general", "set.tab.general", "gear"], ["projects", "set.tab.projects", "folder"], ["agents", "set.tab.agents", "agent"], ["integrations", "set.tab.integrations", "plug"]] as const satisfies readonly (readonly [string, Key, string])[];
type Tab = typeof TABS[number][0];
// language names stay in their own language, so they are findable whatever the app is set to
const LANG_OPTS = () => [["system", t("set.system")], ["en", "English"], ["nl", "Nederlands"], ["fr", "Français"], ["de", "Deutsch"]];
const nc = (s: string) => s.replace(/\s*:\s*$/, ""); // the form labels end in a colon, the fields do without
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// the building blocks (settings.css): a section is a title and hint above a card, a field a label with its control
type SecOpts = { desc?: Tpl; icon?: Tpl; action?: Tpl; foot?: Tpl; list?: boolean };
const sec = (title: Tpl, body: Tpl, o: SecOpts = {}) => html`<section class="ss"><header class="ss-h"><div class="ss-t">${o.icon ? html`<span class="ptile">${o.icon}</span>` : nothing}<div><h2>${title}</h2>${o.desc ? html`<p>${o.desc}</p>` : nothing}</div></div>${o.action ? html`<div class="ss-a">${o.action}</div>` : nothing}</header>
    ${body && body !== nothing ? html`<div class="ss-card${o.list ? " list" : ""}">${body}</div>` : nothing}${o.foot && o.foot !== nothing ? html`<div class="ss-foot">${o.foot}</div>` : nothing}</section>`;
const field = (label: Tpl, ctl: Tpl, o: { hint?: Tpl; id?: string; below?: boolean } = {}) =>
  html`<div class="sf${o.below ? " below" : ""}${o.hint ? " top" : ""}"><div class="sf-l">${o.id ? html`<label for=${o.id}>${label}</label>` : html`<span>${label}</span>`}${o.hint ? html`<p class="sf-h">${o.hint}</p>` : nothing}</div><div class="sf-c">${ctl}</div></div>`;
const sw = (id: string, on: boolean, change: (e: Event) => void) => html`<input type="checkbox" class="sw" role="switch" id=${id} .checked=${on} @change=${change}>`;
const st = (state: "ok" | "warn" | "off", text: Tpl) => html`<span class="st"><span class="sd ${state === "off" ? "" : state}"></span>${text}</span>`;
// a message on the left, the buttons on the right
const foot = (m: Tpl, good: boolean, buttons: Tpl) => html`${m ? html`<span class="${good ? "okmsg" : "errmsg"}">${m}</span>` : nothing}<span class="sp"></span>${buttons}`;
const val = (e: Event) => (e.target as HTMLInputElement).value;

class RelaySettings extends RelayElement {
  static styles = styles(css);

  private loaded = false;
  private settings!: Settings;
  private vs!: VaultStatus;
  // the vault mapping as it is being edited, bound to the inputs
  private map!: VaultMap;
  private msg = ""; private ok = false;
  private tab: Tab = (TABS.find(x => x[0] === localStorage.getItem("prefsTab"))?.[0]) ?? "general";
  // every text input that is only read on Save (token, board fields, GitHub owners), by id; unsaved edits stay until then
  private form: Record<string, string | boolean> = {};
  // board providers: the token sits in the macOS keychain, the backend only says whether there is one
  private tokens: Record<string, boolean> = {};
  private pmsg: Record<string, Msg> = {};
  // GitHub: no token of our own, the app uses gh's login. The status is the account gh is signed in with
  private ghLogin = ""; private ghErr = ""; private ghMsg = ""; private ghOk = false;
  // Mail: no password of our own either, the app reads the app password from the macOS keychain. Edits stay local until Save.
  private mailEdit!: MailCfg; private mailMsg = ""; private mailOk = false;
  private mailNew = { email: "", keychain_service: "", keychain_account: "", pw: "" }; // what sits in the add fields
  private mailBusy = ""; // "connect" or "advanced" while that step runs
  private mailTest: Record<string, Msg | "busy"> = {};
  // agents: what the backend detects per provider (installed, version, login), checked when the window opens
  private agSt: AgentsStatus | null = null; private agMsg = ""; private agOk = false;
  // the lists of agents and integrations: which Add menu is open, which rows are folded open ("ag:claude", "int:github")
  private menu = ""; // "ag" / "int": an Add menu; "b:<provider>": an integration's "…" menu
  private opened = new Set<string>();
  private intMsg = ""; private intOk = false;
  // the project icons live in the vault (.relay/config.json, src/project-icons.ts): every project, folded, to override
  private icons: Record<string, ProjectIcon> | null = null; private iconNames: string[] = []; private iconMsg = ""; private iconOk = false; private finding = false;
  private repos: Record<string, string[]> = {};
  private iconProjects: { name: string; context?: string; summary?: string }[] = [];
  // the boards per vault project, for a provider that lists all its boards in one call: loaded once the pane shows set up
  private allBoards: Record<string, { list: BoardOpt[] | null; err: string }> = {};
  private vaultProjects: string[] | null = null;
  // per board provider: can it take its credentials from Claude Code, and does Claude Code have them (asked once)
  private mcp: Record<string, { supported: boolean; found: boolean }> = {};
  private mcpAsked = false;

  private up = () => this.requestUpdate();

  private keys = (e: KeyboardEvent) => {
    if (e.key === "Escape" || (e.metaKey && e.key === "w")) window.close();
    // Cmd-1 to 4 jump to a page
    const n = e.metaKey && !e.altKey && !e.shiftKey ? Number(e.key) : 0;
    if (n >= 1 && n <= TABS.length) { e.preventDefault(); this.go(TABS[n - 1][0]); }
  };
  private unlisten?: () => void;

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("keydown", this.keys);
    listen("icons-changed", () => { if (this.icons) this.loadIconsPane(); }).then(f => this.unlisten = f);
    this.init();
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("keydown", this.keys);
    this.unlisten?.();
  }
  private async init() {
    this.settings = await invoke<Settings>("get_settings");
    this.vs = await invoke<VaultStatus>("vault_status");
    this.map = { ...this.vs.map };
    this.mailEdit = { ...this.settings.mail, accounts: this.settings.mail?.accounts ?? [] };
    await initI18n();
    this.tokens = Object.fromEntries(await Promise.all(PROVIDERS.map(async p =>
      [p.id, await invoke<boolean>("integration_has_token", { provider: p.id }).catch(() => false)] as const)));
    this.loaded = true; this.up();
    this.ghCheck();
    this.agCheck();
  }

  updated() {
    if (!this.loaded) return;
    const title = t(TABS.find(x => x[0] === this.tab)![1]);
    getCurrentWindow().setTitle(title).catch(() => {});
    document.title = title;
  }

  private go(to: Tab) { this.tab = to; localStorage.setItem("prefsTab", to); this.msg = ""; this.up(); }

  render() {
    if (!this.loaded) return nothing;
    return html`<div class="set" @click=${this.onClick}><nav class="snav"><div class="sn-g">${TABS.map(([id, name, g]) =>
        html`<button class="sn-i${this.tab === id ? " on" : ""}" @click=${() => this.go(id)} aria-current=${this.tab === id ? "page" : nothing}>${ic(g)}<span>${t(name)}</span></button>`)}</div></nav>
      <section class="ppane"><div class="pcol">${this.tab === "general" ? this.general() : this.tab === "projects" ? this.projects() : this.tab === "agents" ? this.agents() : this.integrations()}</div></section></div>`;
  }
  // a web link (Google's app password page) opens in the browser, the settings window never navigates
  private onClick = (e: MouseEvent) => {
    const el = e.target as HTMLElement;
    const link = el.closest<HTMLAnchorElement>("a[href^='https:']");
    if (link) { e.preventDefault(); invoke("plugin:opener|open_url", { url: link.href }); return; }
    if (this.menu && !el.closest(".menu-w")) { this.menu = ""; this.up(); }
  };

  // a path with its folder button inside the field, and a dot for whether the app found it
  private pick(input: Tpl, onPick: () => void, found?: boolean | null, wide = false) {
    return html`<div class="pick${wide ? " wide" : ""}">${found == null ? nothing : html`<span class="sd ${found ? "ok" : "warn"}" title=${t(found ? "vault.found" : "vault.missing")}></span>`}${input}<button class="pick-b" @click=${onPick} title=${t("vault.pickPath")}>${ic("folder")}</button></div>`;
  }
  // a row of a list that folds open to its settings, and the Add menu with what is not in the list yet
  private foldRow(kind: string, id: string, ico: Tpl, name: Tpl, state: Tpl, body: () => Tpl) {
    const key = `${kind}:${id}`, open = this.opened.has(key);
    return html`<div class="arow${open ? " open" : ""}"><button class="arow-h" @click=${() => { if (!this.opened.delete(key)) this.opened.add(key); this.up(); }} aria-expanded=${open}>
      <span class="srow-i">${ico}</span><span class="srow-t"><b>${name}</b>${state}</span>
      <svg class="chev" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg></button>${open ? html`<div class="arow-b">${body()}</div>` : nothing}</div>`;
  }
  private addMenu(kind: "ag" | "int", label: string, items: { id: string; ico: Tpl; name: Tpl; state: Tpl }[]) {
    if (!items.length) return nothing;
    return html`<div class="menu-w"><button class="btn" @click=${() => this.toggleMenu(kind)} aria-expanded=${this.menu === kind}>${label}</button>${this.menu === kind ? html`<div class="menu">${items.map(x =>
      html`<button class="menu-i" @click=${() => this.switchTo(kind, x.id, true)}><span class="ptile">${x.ico}</span><span class="menu-t"><b>${x.name}</b>${x.state}</span></button>`)}</div>` : nothing}</div>`;
  }
  private toggleMenu(k: string) { this.menu = this.menu === k ? "" : k; this.up(); }
  private removeBtn(kind: "ag" | "int", id: string) { return html`<button class="btn ghost" @click=${() => this.switchTo(kind, id, false)}>${t("ag.remove")}</button>`; }
  // add (folded open, to set it up) and remove
  private async switchTo(kind: "ag" | "int", id: string, on: boolean) {
    this.menu = ""; if (on) this.opened.add(`${kind}:${id}`); else this.opened.delete(`${kind}:${id}`);
    if (kind === "ag") await this.agSave(a => { a.providers[id] = { ...a.providers[id], on }; }); else await this.intSwitch(id, on);
  }

  private async save(next: Settings, done: string) {
    try { this.settings = await invoke<Settings>("set_settings", { settings: next }); this.vs = await invoke<VaultStatus>("vault_status"); this.map = { ...this.vs.map }; this.msg = done; this.ok = true; }
    catch (e) { this.msg = String(e); this.ok = false; }
    this.up();
  }

  // ---- General
  private trimmed(): VaultMap { return Object.fromEntries(KEYS.map(([k]) => [k, this.map[k].trim()])) as VaultMap; }
  private general() {
    const { vs, settings } = this;
    const maps = KEYS.map(([k, , req]) => field(html`${th(`vault.k.${k}` as Key)}${req ? nothing : html` <span class="opt">${t("vault.optional")}</span>`}`,
      this.pick(html`<input class="field" .value=${live(this.map[k])} title=${vs.map[k]} spellcheck="false"
          @input=${(e: Event) => { this.map[k] = val(e); }}
          @change=${async () => { this.vs = await checkMapping(vs.vault, this.trimmed()); this.map = { ...this.vs.map }; this.up(); }}>`,
        async () => { this.vs = await pickMapped(this.vs, k, this.trimmed()); this.map = { ...this.vs.map }; this.up(); },
        req || vs.map[k] ? vs.found[k] : null),
      { hint: th(`vault.h.${k}` as Key) }));
    return html`${sec(nc(t("set.vaultLabel")), this.pick(html`<input class="field" id="vaultpath" .value=${vs.vault} title=${vs.vault} placeholder=${t("vault.none")} readonly spellcheck="false">`,
          async () => { this.vs = (await pickVault()) ?? this.vs; this.map = { ...this.vs.map }; this.msg = ""; this.up(); }, null, true),
        { desc: th("set.vaultHelp") })}
      ${sec(t("set.sec.folders"), maps, { desc: th("vault.mapHelp"), foot: foot(this.msg, this.ok, html`<button class="btn primary" @click=${() => this.save({ ...settings, vault: vs.vault, vaults: { ...settings.vaults, [vs.vault]: this.trimmed() } }, t("set.saved"))}>${t("set.save")}</button>`) })}
      ${sec(t("set.sec.interface"), html`
        ${field(t("set.language"), html`<select class="field" id="language" @change=${async (e: Event) => { await this.save({ ...settings, language: val(e) }, ""); await initI18n(); this.up(); }}>${LANG_OPTS().map(([v, name]) =>
          html`<option value=${v} ?selected=${(settings.language || "system") === v}>${name}</option>`)}</select>`, { id: "language", hint: th("set.languageHelp") })}
        ${field(t("set.faviconsOn"), sw("favon", settings.favicons?.on !== false, e => this.save({ ...settings, favicons: { last: "", tried: {}, ...settings.favicons, on: (e.target as HTMLInputElement).checked } }, "")), { id: "favon", hint: th("set.faviconsHelp") })}`)}`;
  }

  // ---- Projects
  private async loadIconsPane() {
    const [i, snap, rp] = await Promise.all([loadIcons(), invoke<any>("snapshot").catch(() => ({ projects: [] })), invoke<Record<string, string[]>>("project_repos").catch(() => ({}))]);
    this.icons = i; this.repos = rp; this.iconProjects = snap.projects || [];
    this.iconNames = this.iconProjects.map(x => String(x.name)).sort((a, b) => a.localeCompare(b));
    this.up();
  }
  // the Projects page: every project, a row folds open to its configuration. The name in Relay stays in the app's
  // settings; the icon and the repos live in the vault's .relay/config.json.
  private projects() {
    const { icons, settings, repos } = this;
    if (!icons) { queueMicrotask(() => this.loadIconsPane()); return sec(t("set.tab.projects"), html`<div class="st"><span class="spin"></span>${t("pr.loading")}</div>`); }
    const preview = (n: string): Tpl => { const i = icons[n], img = iconImg(i?.img, ""); return img !== nothing ? img : i?.icon ? html`<span class="emo">${i.icon}</span>` : ic("folder"); };
    const ctx = (n: string) => this.iconProjects.find(p => p.name === n)?.context ?? "";
    const title = (n: string) => { const l = settings.projects[n]?.label; return l ? html`${l} <span class="opt">${n}</span>` : n; };
    const state = (n: string) => html`<span class="st">${[ctx(n), repos[n]?.length ? tn("pc.repoCount", repos[n].length) : ""].filter(Boolean).join(" · ")}</span>`;
    const body = (n: string) => { const i = icons[n];
      // one input for an emoji or a website; the buttons for an image, none and guessing again
      const v = i?.icon ?? (i && isSite(i.value) ? i.value : "");
      return html`${field(t("pc.name"), html`<input class="field" .value=${live(settings.projects[n]?.label ?? "")} placeholder=${n} spellcheck="false" @change=${async (e: Event) => {
          const next = structuredClone(settings), l = val(e).trim();
          if (l) next.projects[n] = { ...next.projects[n], label: l }; else delete next.projects[n];
          await this.save(next, "");
        }}>`)}
        ${field(t("pc.icon"), html`<span class="iconctl"><span class="itile">${preview(n)}</span><input class="field" .value=${live(v)} placeholder=${t("pc.iconPh")} spellcheck="false"
            @change=${(e: Event) => { const x = val(e).trim(); return this.iconSet(n, !x ? "reset" : isSite(x) ? "site" : "emoji", x); }}>
          <label class="btn ib" title=${t("pi.upload")}>${ic("upload")}<input type="file" accept="image/*,.ico,.svg" hidden @change=${async (e: Event) => {
            const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return;
            const u = await iconFrom(f);
            if (u) await this.iconSet(n, "img", u); else { this.iconMsg = t("img.unreadable"); this.iconOk = false; this.up(); }
          }}></label>
          <button class="btn ib" @click=${() => this.iconSet(n, "none")} title=${t("pi.none")}>${ic("none")}</button>
          <button class="btn ib" @click=${() => this.iconSet(n, "reset")} title=${t("pi.reset")}>${ic("refresh")}</button></span>`, { hint: this.iconHint(n) })}
        ${field(t("pc.repos"), html`<span class="chips">${(repos[n] ?? []).map(r => html`<span class="chip">${r}<button @click=${() => this.setRepos(n, (repos[n] ?? []).filter(x => x !== r))} title=${t("ag.remove")}>×</button></span>`)}
          <input class="field" .value=${live("")} placeholder="owner/repo" spellcheck="false" @change=${(e: Event) => { const x = val(e).trim(); if (x) return this.setRepos(n, [...(repos[n] ?? []), x]); }}></span>`, { hint: t("pc.reposHelp") })}`; };
    const m = this.iconMsg || this.msg;
    return sec(t("set.tab.projects"), this.iconNames.length ? this.iconNames.map(n => this.foldRow("proj", n, preview(n), title(n), state(n), () => body(n))) : html`<div class="sempty">${t("set.none")}</div>`,
      { desc: th("pc.desc"), list: true, foot: m ? foot(m, this.iconMsg ? this.iconOk : this.ok, nothing) : nothing,
        action: html`<button class="btn" @click=${() => this.findIcons()} title=${t("pi.findHelp")} ?disabled=${this.finding}>${this.finding ? html`<span class="spin"></span> ${t("pi.finding")}` : t("pi.find")}</button>` });
  }
  // what the icon is now, under the icon line
  private iconHint(n: string) {
    const i = this.icons?.[n];
    if (!i) return t("pi.guess");
    if (i.img) return t("pi.image");
    if (i.icon) return t("pi.emoji");
    if (isSite(i.value)) return this.settings.favicons?.tried?.[n] === i.value ? t("pi.siteNoIcon", { site: i.value }) : t("pi.siteSoon", { site: i.value });
    return t("pi.noIcon");
  }
  private async setRepos(project: string, list: string[]) {
    try { await invoke("set_project_repos", { project, repos: list }); this.iconMsg = ""; this.iconOk = true; this.repos = await invoke<Record<string, string[]>>("project_repos"); }
    catch (x) { this.iconMsg = String(x); this.iconOk = false; }
    this.up();
  }
  // Find icons: Claude looks up the website of every project without an icon (or set to none), its favicon follows
  private async findIcons() {
    const targets = this.iconProjects.filter(p => { const i = this.icons?.[p.name]; return !i || i.value === ""; });
    if (!targets.length) { this.iconMsg = t("pi.findNone"); this.iconOk = true; this.up(); return; }
    this.finding = true; this.iconMsg = ""; this.up();
    try {
      const found = await invoke<Record<string, string>>("find_icon_sites", { projects: targets.map(p => ({ name: p.name, context: p.context ?? "", summary: p.summary ?? "" })) });
      for (const [n, site] of Object.entries(found)) await setIcon(n, "site", site);
      const n = Object.keys(found).length;
      this.iconMsg = n ? t("pi.found", { n, total: targets.length }) : t("pi.findNone"); this.iconOk = true;
    } catch (x) { this.iconMsg = String(x); this.iconOk = false; }
    this.finding = false; this.up();
  }
  // the backend emits icons-changed, which reloads the pane
  private async iconSet(project: string, kind: IconKind, value = "") {
    try { await setIcon(project, kind, value); this.iconMsg = ""; this.iconOk = true; } catch (x) { this.iconMsg = String(x); this.iconOk = false; this.up(); }
  }

  // ---- Integrations
  // set up: every secret in the keychain and every field that is not optional
  private setUp = (p: BoardProvider) => this.tokens[p.id] && p.settings.fields.every(f => f.optional || f.secret || this.settings.integrations[p.id]?.[f.key]);
  private async loadBoards(p: BoardProvider) {
    this.allBoards[p.id] = { list: null, err: "" };
    try {
      const [list, snap] = await Promise.all([p.settings.allBoards!(ctxOf(p, this.settings.integrations)), this.vaultProjects ?? invoke<any>("snapshot")]);
      this.vaultProjects ??= (snap.projects || []).map((x: any) => String(x.name)).sort((a: string, b: string) => a.localeCompare(b));
      this.allBoards[p.id] = { list, err: "" };
    } catch (e) { this.allBoards[p.id] = { list: [], err: String(e) }; }
    this.up();
  }
  private boardMap(p: BoardProvider): Tpl {
    if (!p.settings.allBoards || !this.setUp(p)) return nothing;
    const b = this.allBoards[p.id];
    if (!b) { queueMicrotask(() => this.loadBoards(p)); return nothing; }
    if (!b.list) return html`<div class="hint">${t("pr.loading")}</div>`;
    if (b.err) return html`<div class="setrow"><span class="errmsg">${b.err}</span></div>`;
    const opts = (vp: string) => { const cur = this.settings.boards?.[vp], mine = cur?.provider === p.id;
      return html`<option value="">${mine || !cur ? t("kb.linkNone") : provider(cur.provider)?.name ?? cur.provider}</option>${b.list!.map(o =>
        html`<option value="${o.project}/${o.id}" ?selected=${mine && cur.board === o.id}>${o.group} › ${o.name}</option>`)}`; };
    return html`<div class="sub"><b>${t("int.boards")}</b><p class="hint">${th("int.boardsHelp")}</p></div>
      ${(this.vaultProjects || []).map(vp => field(vp, html`<select class="field" @change=${(e: Event) => this.mapBoard(p, vp, val(e))}>${opts(vp)}</select>`))}`;
  }
  private async mapBoard(p: BoardProvider, vp: string, value: string) {
    // a vault project has at most one board: picking one replaces what it had, None only drops this provider's
    const boards = { ...this.settings.boards }, [project, board] = value.split("/");
    if (board) boards[vp] = { provider: p.id, project, board }; else if (boards[vp]?.provider === p.id) delete boards[vp]; else return;
    try { this.settings = await invoke<Settings>("set_settings", { settings: { ...this.settings, boards } }); this.pmsg[p.id] = { text: t("set.saved"), ok: true }; }
    catch (x) { this.pmsg[p.id] = { text: String(x), ok: false }; }
    this.up();
  }
  // the integrations: the ones in use are listed (a board provider set up or added, GitHub and Mail switched on), the
  // others are in the Add menu. In the list means in the sidebar; Remove switches it off and keeps the token.
  private ghState() { return st(this.ghLogin ? "ok" : this.ghErr ? "warn" : "off", this.ghLogin ? t("gh.connected", { login: this.ghLogin }) : this.ghErr || t("gh.checking")); }
  private mailState() { return st(this.mailEdit.accounts.length ? "ok" : "off", t("mail.accounts", { n: this.mailEdit.accounts.length })); }
  private askMcp() {
    if (this.mcpAsked) return; this.mcpAsked = true;
    Promise.all(PROVIDERS.map(async p => { this.mcp[p.id] = await invoke<{ supported: boolean; found: boolean }>("integration_mcp", { provider: p.id }).catch(() => ({ supported: false, found: false })); })).then(this.up);
  }
  private boardState(p: BoardProvider) { return !this.setUp(p) && this.mcp[p.id]?.found ? st("warn", t("int.foundClaude")) : st(this.setUp(p) ? "ok" : "off", this.setUp(p) ? t("int.set") : t("int.notSet")); }
  private boardOn(p: BoardProvider) { const on = this.settings.integrations[p.id]?.on; return on === true || (on === undefined && this.setUp(p)); }
  private integrations() {
    this.askMcp();
    const all = [
      ...PROVIDERS.map(p => ({ id: p.id, ico: pIcon(p), name: p.name as Tpl, state: this.boardState(p), on: this.boardOn(p), body: () => this.boardBody(p) })),
      { id: "github", ico: ic("gh"), name: "GitHub" as Tpl, state: this.ghState(), on: !!this.settings.github.on, body: () => this.github() },
      { id: "mail", ico: ic("mail"), name: "Mail" as Tpl, state: this.mailState(), on: !!this.settings.mail?.on, body: () => this.mail() },
    ];
    const act = all.filter(x => x.on);
    return sec(t("set.tab.integrations"), act.length ? act.map(x => this.foldRow("int", x.id, x.ico, x.name, x.state, x.body)) : html`<div class="sempty">${t("int.empty")}</div>`,
      { desc: th("int.listHelp"), action: this.addMenu("int", t("int.add"), all.filter(x => !x.on)), list: true, foot: this.intMsg ? foot(this.intMsg, this.intOk, nothing) : nothing });
  }
  // an integration in or out of the list: on for the sidebar, a board provider's token stays in the keychain
  private async intSwitch(id: string, on: boolean) {
    const next = structuredClone(this.settings);
    if (id === "github") next.github.on = on;
    else if (id === "mail") next.mail = { ...next.mail, on };
    else next.integrations[id] = { ...next.integrations[id], on };
    try { this.settings = await invoke<Settings>("set_settings", { settings: next }); if (id === "mail") this.mailEdit.on = on; this.intMsg = ""; this.intOk = true; }
    catch (x) { this.intMsg = String(x); this.intOk = false; }
    this.up();
  }

  // text inputs read on Save live in `form`, by id
  private fstr(id: string, d: unknown = "") { const v = this.form[id]; return typeof v === "string" ? v : String(d ?? ""); }
  private inp = (id: string) => (e: Event) => { this.form[id] = val(e); };

  private github() {
    const { settings } = this;
    return html`<p class="hint">${th("gh.help")}</p>
      ${field(nc(t("gh.owners")), html`<input class="field" id="ghowners" .value=${live(this.fstr("ghowners", settings.github.owners))} @input=${this.inp("ghowners")} spellcheck="false" placeholder=${t("gh.ownersPh")}>`, { id: "ghowners" })}
      <div class="ss-foot">${this.removeBtn("int", "github")}${foot(this.ghMsg, this.ghOk, html`<button class="btn" @click=${() => this.ghCheck()}>${t("gh.recheck")}</button><button class="btn primary" @click=${() => this.ghSave()}>${t("set.save")}</button>`)}</div>`;
  }
  private async ghSave() {
    const next = { ...this.settings, github: { ...this.settings.github, owners: this.fstr("ghowners", this.settings.github.owners).trim() } };
    try { this.settings = await invoke<Settings>("set_settings", { settings: next }); delete this.form.ghowners; this.ghMsg = t("set.saved"); this.ghOk = true; }
    catch (x) { this.ghMsg = String(x); this.ghOk = false; }
    this.up();
  }
  private async ghCheck() {
    this.ghLogin = ""; this.ghErr = ""; this.up();
    try { this.ghLogin = await invoke<string>("github_status"); } catch (e) { this.ghErr = String(e); }
    this.up();
  }

  // a backend error as what to do about it, with the raw message small below for when it is something else
  private mailErr(e: string): Tpl {
    const k = /^Login failed/.test(e) ? "mail.errLogin" : /No password in the keychain/.test(e) ? "mail.errNoPw" : /not approved in time/.test(e) ? "mail.errKeychain"
      : /Only Gmail/.test(e) ? "mail.errGmail" : /IMAP (connection|timeout|protocol)/.test(e) ? "mail.errNet" : "";
    return k ? html`${t(k)}<div class="hint">${e}</div>` : e;
  }
  private mail() {
    const c = this.mailEdit, mn = this.mailNew;
    const tr = (a: MailAcct): Tpl => { const r = this.mailTest[a.email]; return r === "busy" ? html`<span class="spin"></span>` : r ? html`<span class="${r.ok ? "okmsg" : "errmsg"}">${r.ok ? t("mail.testOk", { n: Number((r.text.match(/\d+/) || ["0"])[0]).toLocaleString(currentLocale()) }) : this.mailErr(r.text)}</span>` : nothing; };
    const busy = (k: string) => this.mailBusy === k ? html`<span class="spin"></span> ${t("mail.connecting")}` : nothing;
    const accts = c.accounts.map(a => html`<div class="srow"><span class="srow-t"><b>${a.email}</b><span>${t("mail.inKeychain", { svc: a.keychain_service })}</span></span>${tr(a)}
      <span class="srow-x"><button class="btn" @click=${() => this.mailTestOne(a)}>${t("mail.test")}</button><button class="btn ghost" @click=${() => { delete this.mailTest[a.email]; c.accounts = c.accounts.filter(x => x.email !== a.email); if (c.account === a.email) c.account = ""; this.up(); }}>${t("mail.remove")}</button></span></div>`);
    const emailIn = (id: string) => field(nc(t("mail.emailL")), html`<input class="field" id=${id} type="email" .value=${live(mn.email)} @input=${(e: Event) => { mn.email = val(e); }} placeholder="naam@bedrijf.be" spellcheck="false" autocomplete="off">`, { id });
    return html`<p class="hint">${t("mail.help")}</p>
      ${accts.length ? html`<div class="sub"><b>${t("mail.accountsH")}</b></div><div class="slist">${accts}</div>` : nothing}
      ${c.accounts.length > 1 ? field(nc(t("mail.account")), html`<select class="field" id="mailacct" @change=${(e: Event) => { c.account = val(e); }}>${c.accounts.map(a =>
        html`<option value=${a.email} ?selected=${a.email === (c.account || c.accounts[0].email)}>${a.email}</option>`)}</select>`, { id: "mailacct" }) : nothing}
      <div class="ss-foot">${this.removeBtn("int", "mail")}${foot(this.mailMsg && (this.mailOk ? this.mailMsg : this.mailErr(this.mailMsg)), this.mailOk, html`<button class="btn primary" @click=${() => this.mailSave()}>${t("set.save")}</button>`)}</div>
      <div class="sub"><b>${c.accounts.length ? t("mail.guideMore") : t("mail.guideH")}</b></div>
      <div class="mstep"><b>${t("mail.step1H")}</b><p>${th("mail.step1")}</p>
        <a class="btn" href="https://myaccount.google.com/apppasswords" target="_blank">${t("mail.step1Btn")}</a>
        <p class="hint">${th("mail.step1Hint")}</p></div>
      <div class="mstep"><b>${t("mail.step2H")}</b>
        ${emailIn("mailnew")}
        ${field(nc(t("mail.pwL")), html`<input class="field" id="mailpw" type="password" .value=${live(mn.pw)} @input=${(e: Event) => { mn.pw = val(e); }} placeholder=${t("mail.pwPh")} autocomplete="off" spellcheck="false">`, { id: "mailpw" })}
        <div class="setrow"><button class="btn primary" @click=${() => this.mailConnect()} ?disabled=${!!this.mailBusy}>${t("mail.connect")}</button>${busy("connect")}</div>
        <p class="hint">${th("mail.step2Hint")}</p></div>
      <details class="mstep" ?open=${!!mn.keychain_service}><summary>${t("mail.advH")}</summary>
        <p class="hint">${th("mail.adv")}</p>
        ${emailIn("mailemail2")}
        ${field(nc(t("mail.svcL")), html`<input class="field" id="mailsvc" .value=${live(mn.keychain_service)} @input=${(e: Event) => { mn.keychain_service = val(e); }} placeholder="himalaya-weareantenna-imap" spellcheck="false">`, { id: "mailsvc" })}
        ${field(nc(t("mail.kaccL")), html`<input class="field" id="mailkacc" .value=${live(mn.keychain_account)} @input=${(e: Event) => { mn.keychain_account = val(e); }} placeholder="weareantenna" spellcheck="false">`, { id: "mailkacc" })}
        <div class="setrow"><button class="btn" @click=${() => this.mailAdd()} ?disabled=${!!this.mailBusy}>${t("mail.addTest")}</button>${busy("advanced")}</div>
      </details>`;
  }
  // add an account that passed its test and save at once, so nothing is left half set up
  private async mailKeep(a: MailAcct, result: string) {
    this.mailEdit.accounts = [...this.mailEdit.accounts.filter(x => x.email.toLowerCase() !== a.email.toLowerCase()), a];
    this.settings = await invoke<Settings>("set_settings", { settings: { ...this.settings, mail: { ...this.mailEdit, on: true } } });
    this.mailEdit = { ...this.settings.mail, accounts: this.settings.mail?.accounts ?? [] };
    this.mailTest[a.email] = { text: result, ok: true };
    this.mailMsg = t("mail.connected", { email: a.email, n: (result.match(/\d+/) || ["?"])[0] }); this.mailOk = true;
    Object.assign(this.mailNew, { email: "", pw: "", keychain_service: "", keychain_account: "" });
  }
  private async mailConnect() {
    const mn = this.mailNew;
    if (!EMAIL.test(mn.email.trim())) { this.mailMsg = t("mail.invalid"); this.mailOk = false; this.up(); return; }
    this.mailBusy = "connect"; this.mailMsg = ""; this.up();
    try { const r = await invoke<{ account: MailAcct; result: string }>("mail_connect", { email: mn.email, password: mn.pw }); await this.mailKeep(r.account, r.result); }
    catch (x) { this.mailMsg = String(x); this.mailOk = false; }
    this.mailBusy = ""; mn.pw = ""; this.up();
  }
  private async mailAdd() {
    const mn = this.mailNew, a = { email: mn.email.trim(), keychain_service: mn.keychain_service.trim(), keychain_account: mn.keychain_account.trim() };
    if (!EMAIL.test(a.email) || !a.keychain_service || !a.keychain_account) { this.mailMsg = t("mail.invalid"); this.mailOk = false; this.up(); return; }
    this.mailBusy = "advanced"; this.mailMsg = ""; this.up();
    try { await this.mailKeep(a, await invoke<string>("mail_test", { account: a })); }
    catch (x) { this.mailMsg = String(x); this.mailOk = false; }
    this.mailBusy = ""; this.up();
  }
  private async mailTestOne(a: MailAcct) {
    this.mailTest[a.email] = "busy"; this.up();
    try { this.mailTest[a.email] = { text: await invoke<string>("mail_test", { account: a }), ok: true }; } catch (x) { this.mailTest[a.email] = { text: String(x), ok: false }; }
    this.up();
  }
  private async mailSave() {
    try { this.settings = await invoke<Settings>("set_settings", { settings: { ...this.settings, mail: this.mailEdit } }); this.mailEdit = { ...this.settings.mail, accounts: this.settings.mail?.accounts ?? [] }; this.mailMsg = t("set.saved"); this.mailOk = true; }
    catch (x) { this.mailMsg = String(x); this.mailOk = false; }
    this.up();
  }

  // one board provider: the token, the fields of its config, its boards per vault project
  private boardBody(p: BoardProvider) {
    const cfg = this.settings.integrations[p.id] || {}, has = this.tokens[p.id], m = this.pmsg[p.id], id = p.id;
    const secretPh = has ? t("int.tokenStored") : t("int.tokenPaste");
    const fields = p.settings.fields.map(f => { const fid = `f-${id}-${f.key}`;
      return f.check ? field(f.placeholder ? pt(p, f.placeholder) : pt(p, f.label), sw(fid, !!(this.form[fid] ?? cfg[f.key]), e => { this.form[fid] = (e.target as HTMLInputElement).checked; }), { id: fid })
        : field(nc(pt(p, f.label)), f.secret
          ? html`<input class="field" id=${fid} type="password" autocomplete="off" placeholder=${secretPh} .value=${live(this.fstr(fid))} @input=${this.inp(fid)} spellcheck="false">`
          : html`<input class="field" id=${fid} inputmode=${f.numeric ? "numeric" : nothing} .value=${live(this.fstr(fid, cfg[f.key]))} @input=${this.inp(fid)} placeholder=${f.placeholder ? pt(p, f.placeholder) : nothing} spellcheck="false">`, { id: fid }); });
    // the rarer actions behind "…": take the credentials from Claude Code, clear the token
    const items = [this.mcp[id]?.supported ? html`<button class="menu-i" @click=${() => this.boardImport(p)}><span class="menu-t"><b>${t("int.importClaude")}</b><span class="st">${t(this.mcp[id]?.found ? "int.importFound" : "int.importNone")}</span></span></button>` : null,
      has ? html`<button class="menu-i" @click=${() => this.boardClear(p)}><span class="menu-t"><b>${t("int.clear")}</b></span></button>` : null].filter(Boolean);
    const more = items.length ? html`<div class="menu-w"><button class="btn ib" @click=${() => this.toggleMenu(`b:${id}`)} title=${t("int.more")} aria-expanded=${this.menu === `b:${id}`}>${ic("more")}</button>${this.menu === `b:${id}` ? html`<div class="menu up">${items}</div>` : nothing}</div>` : nothing;
    const found = !this.setUp(p) && this.mcp[id]?.found ? html`<div class="notice"><span>${t("int.foundClaudeLong", { name: p.name })}</span><button class="btn primary" @click=${() => this.boardImport(p)}>${t("int.import")}</button></div>` : nothing;
    return html`${found}<p class="hint">${pth(p, p.settings.help)}</p>
      ${field(nc(pt(p, p.settings.tokenLabel)), html`<input class="field" id="tok-${id}" type="password" autocomplete="off" placeholder=${secretPh} .value=${live(this.fstr(`tok-${id}`))} @input=${this.inp(`tok-${id}`)} spellcheck="false">`, { id: `tok-${id}` })}
      ${fields}
      <div class="ss-foot">${this.removeBtn("int", p.id)}${more}${foot(m ? m.text : "", !!m?.ok, html`<button class="btn primary" @click=${() => this.boardSaveForm(p)}>${t("int.save")}</button>`)}</div>
      ${this.boardMap(p)}`;
  }
  private async boardSaveForm(p: BoardProvider) {
    const cfg: Record<string, any> = { ...this.settings.integrations[p.id], on: true };
    const secrets: Record<string, string> = { token: this.fstr(`tok-${p.id}`).trim() };
    for (const f of p.settings.fields) {
      const fid = `f-${p.id}-${f.key}`;
      if (f.check) cfg[f.key] = !!(this.form[fid] ?? cfg[f.key]);
      else if (f.secret) secrets[f.key] = this.fstr(fid).trim();
      else cfg[f.key] = this.fstr(fid, cfg[f.key]).trim();
    }
    this.pmsg[p.id] = { text: t("int.busy"), ok: true }; this.up();
    await this.boardSave(p, cfg, secrets);
    // the form shows what is stored now: the secrets are cleared, the rest follows the saved config
    for (const k of Object.keys(this.form)) if (k === `tok-${p.id}` || k.startsWith(`f-${p.id}-`)) delete this.form[k];
    this.up();
  }
  // saves the token and the config, then one call to the provider to show they work together
  private async boardSave(p: BoardProvider, cfg: Record<string, any>, secrets: Record<string, string> = {}) {
    try {
      for (const [account, token] of Object.entries(secrets)) if (token) await invoke("integration_token", { provider: p.id, token, account });
      this.tokens[p.id] = await invoke<boolean>("integration_has_token", { provider: p.id });
      this.settings = await invoke<Settings>("set_settings", { settings: { ...this.settings, integrations: { ...this.settings.integrations, [p.id]: cfg } } });
      this.pmsg[p.id] = { text: await p.settings.test(ctxOf(p, this.settings.integrations)), ok: true };
      delete this.allBoards[p.id];
    } catch (e) { this.pmsg[p.id] = { text: String(e), ok: false }; }
    this.up();
  }
  private async boardImport(p: BoardProvider) {
    this.menu = "";
    try { const r = await invoke<Record<string, string>>("integration_import", { provider: p.id }); await this.boardSave(p, { ...this.settings.integrations[p.id], ...r }); }
    catch (e) { this.pmsg[p.id] = { text: String(e), ok: false }; this.up(); }
  }
  private async boardClear(p: BoardProvider) {
    this.menu = "";
    await invoke("integration_token", { provider: p.id, token: "" }); this.tokens[p.id] = false; delete this.allBoards[p.id]; this.pmsg[p.id] = { text: t("int.cleared"), ok: true }; this.up();
  }

  // ---- Agents
  // the agents: only the ones switched on are listed, the others are in the Add menu. A row folds open to its
  // program and options. Every change saves at once.
  private agCfg = (id: string) => this.settings.agents?.providers[id] ?? { on: false, bin: "" };
  private agState(p: AgentStatus) {
    const d = p.detect;
    const found = d.installed ? (d.version ? t("ag.installed", { version: d.version }) : t("ag.installedNoVersion")) : t("ag.missing", { bin: d.bin });
    const login = d.loggedIn == null ? "" : ` · ${d.loggedIn ? t("ag.loggedIn") : t("ag.loggedOut")}`;
    return st(!d.installed ? "off" : d.loggedIn === false ? "warn" : "ok", found + login);
  }
  private agents() {
    const { agSt, settings } = this;
    if (!agSt) return sec(t("set.tab.agents"), html`<div class="st"><span class="spin"></span>${this.agMsg || t("ag.checking")}</div>`);
    const act = agSt.providers.filter(p => this.agCfg(p.id).on), rest = agSt.providers.filter(p => !this.agCfg(p.id).on);
    const add = this.addMenu("ag", t("ag.add"), rest.map(p => ({ id: p.id, ico: agGlyph(p.id), name: p.name, state: this.agState(p) })));
    return html`${sec(t("set.tab.agents"), act.length ? act.map(p => this.foldRow("ag", p.id, agGlyph(p.id),
          html`${p.name}${settings.agents?.default === p.id ? html` <span class="pill">${t("ag.isDefault")}</span>` : nothing}`, this.agState(p), () => this.agentBody(p))) : html`<div class="sempty">${t("ag.empty")}</div>`,
        { desc: th("ag.listHelp"), action: html`<button class="btn ghost" @click=${() => { this.agMsg = ""; this.agCheck(true); }}>${t("ag.recheck")}</button>${add}`, list: true, foot: this.agMsg ? foot(this.agMsg, this.agOk, nothing) : nothing })}
      ${/* with one agent there is nothing to choose */ act.length > 1 ? sec(t("ag.default"), nothing, { desc: th("ag.defaultHelp"), action: html`<select class="field" id="agdefault" aria-label=${t("ag.default")} @change=${(e: Event) => { const v = val(e); return this.agSave(a => { a.default = v; }); }}>${act.map(p =>
          html`<option value=${p.id} ?selected=${settings.agents?.default === p.id}>${p.name}</option>`)}</select>` }) : nothing}`;
  }
  private agentBody(p: AgentStatus) {
    const cfg = this.agCfg(p.id), d = p.detect, ap = agent(p.id), id = p.id;
    const caps = (["images", "permissions", "questions", "subagents", "terminal", "limits", "effort"] as const).filter(c => p.caps[c]).map(c => html`<span class="pill">${t(`ag.cap.${c}`)}</span>`);
    return html`${ap ? html`<p class="hint">${ath(ap, "set.help")}</p>` : nothing}
      ${field(nc(t("ag.bin")), html`<input class="field" id="agbin-${id}" .value=${live(cfg.bin)} placeholder=${t("ag.binPh", { bin: p.defaultBin })} spellcheck="false"
          @change=${async (e: Event) => { const v = val(e).trim(); await this.agSave(a => { a.providers[id] = { ...a.providers[id], bin: v }; }); this.agCheck(true); }}>`, { id: `agbin-${id}`, hint: d.note ? html`<code>${d.note}</code>` : "" })}
      ${(ap?.options ?? []).map(o => field(at(ap!, o.label), html`<select class="field" id="agopt-${id}-${o.id}" @change=${(e: Event) => { const v = val(e); return this.agSave(a => { a.providers[id] = { ...a.providers[id], [o.id]: v }; }); }}>${o.choices.map(c =>
        html`<option value=${c.id} ?selected=${(cfg[o.id] ?? o.choices[0].id) === c.id}>${at(ap!, c.label)}</option>`)}</select>`, { id: `agopt-${id}-${o.id}` }))}
      ${field(nc(t("ag.caps")), html`<span class="pills">${caps}</span>`)}
      <div class="ss-foot"><span class="sp"></span>${this.removeBtn("ag", p.id)}</div>`;
  }
  // one change to settings.agents, saved; the backend keeps the default on a switched-on agent
  private async agSave(change: (a: Settings["agents"]) => void) {
    const agents = structuredClone(this.settings.agents); change(agents);
    try { this.settings = await invoke<Settings>("set_settings", { settings: { ...this.settings, agents } }); this.agMsg = ""; this.agOk = true; }
    catch (x) { this.agMsg = String(x); this.agOk = false; }
    this.up();
  }
  private async agCheck(quiet = false) {
    if (!quiet) { this.agSt = null; this.up(); }
    try { this.agSt = await agentsStatus(); } catch (e) { this.agMsg = String(e); this.agOk = false; }
    this.up();
  }
}
customElements.define("relay-settings", RelaySettings);
declare global { interface HTMLElementTagNameMap { "relay-settings": RelaySettings } }
