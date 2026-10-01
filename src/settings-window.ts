import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./settings.css";
import { currentLocale, initI18n, pt, t } from "./i18n";
import type { Key } from "./locales/en";
import { PROVIDERS, provider, ctxOf, type BoardOpt, type BoardProvider, type BoardRef } from "./providers";
import { renderMapping, readMapping, pickVault, pickMapped, checkMapping, type VaultStatus, type VaultMap, type MapKey } from "./vault-setup";

// The settings window, laid out like Mail's: a toolbar of icon tabs, the window title follows the tab.
// General holds the vault folder with its mapping and the language, Projects the projects the user customised,
// Integrations the external services (the board providers from src/providers/, GitHub, Mail) as a list on the left with the details on the right,
// like Mail's Accounts. Saving emits "settings-changed" from the backend, the main window follows it.
type MailAcct = { email: string; keychain_service: string; keychain_account: string };
type MailCfg = { on: boolean; account: string; accounts: MailAcct[] };
type Settings = { vault: string; vaults?: Record<string, VaultMap>; projects: Record<string, { icon?: string; img?: string; label?: string }>; overrides: Record<string, string | null>;
  integrations: Record<string, Record<string, any>>; boards: Record<string, BoardRef>; github: { on: boolean; owners: string }; mail: MailCfg; language?: string;
  favicons?: { on: boolean; last: string; tried: Record<string, string> } };
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const root = document.getElementById("set")!;
let settings: Settings = await invoke<Settings>("get_settings");
let vs: VaultStatus = await invoke<VaultStatus>("vault_status");
let msg = "", ok = false;
await initI18n();
// board providers: the token sits in the macOS keychain, the backend only says whether there is one
const tokens: Record<string, boolean> = Object.fromEntries(await Promise.all(PROVIDERS.map(async p =>
  [p.id, await invoke<boolean>("integration_has_token", { provider: p.id }).catch(() => false)] as const)));
const pmsg: Record<string, { text: string; ok: boolean }> = {};
// GitHub: no token of our own, the app uses gh's login. The status is the account gh is signed in with
let ghLogin = "", ghErr = "", ghMsg = "", ghOk = false;
// Mail: no password of our own either, the app reads the app password from the macOS keychain. Edits stay local until Save.
let mailEdit: MailCfg = { ...settings.mail, accounts: settings.mail?.accounts ?? [] }, mailMsg = "", mailOk = false;
const mailNew = { email: "", keychain_service: "", keychain_account: "", pw: "" }; // what sits in the add fields, survives a redraw
let mailBusy = ""; // "connect" or "advanced" while that step runs
const mailTest: Record<string, { text: string; ok: boolean } | "busy"> = {};
let acct = localStorage.getItem("prefsAcct") || "";
if (acct !== "github" && acct !== "mail" && !provider(acct)) acct = PROVIDERS[0].id;

const G: Record<string, string> = {
  gear: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  folder: '<path d="M3.5 7V6a1.5 1.5 0 0 1 1.5-1.5h4.5l2 2H19A1.5 1.5 0 0 1 20.5 8v10a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18V7Z"/>',
  plug: '<path d="M9 3.5v4M15 3.5v4M6.5 7.5h11v3a5.5 5.5 0 0 1-11 0v-3ZM12 16v4.5"/>',
  // GitHub's mark (octicon mark-github), in the label colour
  gh: '<path transform="translate(4 4)" fill="currentColor" stroke="none" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>',
  mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m4.5 7 7.5 6 7.5-6"/>',
};
const icon = (n: string) => `<svg viewBox="0 0 24 24">${G[n]}</svg>`;
// a provider's 16×16 glyph on the 24×24 tile
const pIcon = (p: BoardProvider) => `<svg viewBox="0 0 24 24"><g transform="scale(1.5)">${p.glyph}</g></svg>`;
const TABS = [["general", "set.tab.general", "gear"], ["projects", "set.tab.projects", "folder"], ["integrations", "set.tab.integrations", "plug"]] as const satisfies readonly (readonly [string, Key, string])[];
type Tab = typeof TABS[number][0];
let tab: Tab = (TABS.find(x => x[0] === localStorage.getItem("prefsTab"))?.[0]) ?? "general";

function general() {
  return `<div class="form">
      <span class="fl">${t("set.vaultLabel")}</span>
      <div class="setrow"><input class="field" id="vaultpath" value="${esc(vs.vault)}" placeholder="${t("vault.none")}" readonly spellcheck="false"><button class="btn" data-set="pick">${t("set.pick")}</button></div>
      <span></span><div class="hint">${t("set.vaultHelp")}</div>
    </div>
    <div class="hint">${t("vault.mapHelp")}</div>
    ${renderMapping(vs)}
    <div class="setrow end">${msg ? `<span class="${ok ? "okmsg" : "errmsg"}">${esc(msg)}</span>` : ""}<button class="btn primary" data-set="save">${t("set.save")}</button></div>
    <div class="form">
      <label class="fl" for="language">${t("set.language")}</label>
      <select class="field" id="language">${LANG_OPTS().map(([v, name]) =>
        `<option value="${v}" ${(settings.language || "system") === v ? "selected" : ""}>${esc(name)}</option>`).join("")}</select>
      <span></span><div class="hint">${t("set.languageHelp")}</div>
      <span class="fl">${t("set.favicons")}</span><label class="chk"><input type="checkbox" id="favon" ${settings.favicons?.on !== false ? "checked" : ""}> ${t("set.faviconsOn")}</label>
      <span></span><div class="hint">${t("set.faviconsHelp")}</div>
    </div>`;
}
function projects() {
  const custom = Object.entries(settings.projects).filter(([, c]) => c.icon || c.img || c.label);
  return `<div class="hint">${t("set.customHelp")}</div>
    ${custom.length ? `<ul class="todo">${custom.map(([n, c]) => `<li class="setli"><span>${c.img && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(c.img) ? `<img class="pimg" src="${c.img}" alt="">` : esc(c.icon || "")} ${esc(c.label || n)} <span class="count">${c.label ? esc(n) : ""}</span></span><button class="btn" data-set="clear" data-p="${esc(n)}">${t("set.reset")}</button></li>`).join("")}</ul>`
      : `<div class="hint">${t("set.none")}</div>`}
    ${msg ? `<div class="setrow end"><span class="${ok ? "okmsg" : "errmsg"}">${esc(msg)}</span></div>` : ""}`;
}
// set up: every secret in the keychain and every field that is not optional
const setUp = (p: BoardProvider) => tokens[p.id] && p.settings.fields.every(f => f.optional || f.secret || settings.integrations[p.id]?.[f.key]);
// the boards per vault project, for a provider that lists all its boards in one call: loaded once the pane shows set up
const allBoards: Record<string, { list: BoardOpt[] | null; err: string }> = {};
let vaultProjects: string[] | null = null;
async function loadBoards(p: BoardProvider) {
  allBoards[p.id] = { list: null, err: "" };
  try {
    const [list, snap] = await Promise.all([p.settings.allBoards!(ctxOf(p, settings.integrations)), vaultProjects ?? invoke<any>("snapshot")]);
    vaultProjects ??= (snap.projects || []).map((x: any) => String(x.name)).sort((a: string, b: string) => a.localeCompare(b));
    allBoards[p.id] = { list, err: "" };
  } catch (e) { allBoards[p.id] = { list: [], err: String(e) }; }
  render();
}
function boardMap(p: BoardProvider) {
  if (!p.settings.allBoards || !setUp(p)) return "";
  const st = allBoards[p.id];
  if (!st) { queueMicrotask(() => loadBoards(p)); return ""; }
  if (!st.list) return `<div class="hint">${t("pr.loading")}</div>`;
  if (st.err) return `<div class="setrow"><span class="errmsg">${esc(st.err)}</span></div>`;
  const opts = (vp: string) => { const cur = settings.boards?.[vp], mine = cur?.provider === p.id;
    return `<option value="">${mine || !cur ? t("kb.linkNone") : esc(provider(cur.provider)?.name ?? cur.provider)}</option>`
      + st.list!.map(b => `<option value="${esc(b.project)}/${esc(b.id)}"${mine && cur.board === b.id ? " selected" : ""}>${esc(b.group)} › ${esc(b.name)}</option>`).join(""); };
  return `<h3 class="ahead">${t("int.boards")}</h3><div class="form">
    ${(vaultProjects || []).map(vp => `<label class="fl">${esc(vp)}</label><select class="field" data-bmap="${esc(vp)}">${opts(vp)}</select>`).join("\n    ")}
    <span></span><div class="hint">${t("int.boardsHelp")}</div></div>`;
}
function integrations() {
  const gh = !!ghLogin && settings.github.on;
  const li = (id: string, tile: string, name: string, on: boolean) =>
    `<li class="${acct === id ? "sel" : ""}" data-acct="${id}"><span class="atile ${id}">${tile}</span><span><b>${name}</b><span class="asub">${on ? t("int.set") : t("int.notSet")}</span></span></li>`;
  const p = provider(acct);
  return `<div class="accts">
    <ul class="alist">${PROVIDERS.map(x => li(x.id, pIcon(x), esc(x.name), setUp(x))).join("")}${li("github", icon("gh"), "GitHub", gh)}${li("mail", icon("mail"), "Mail", !!settings.mail?.accounts?.length && settings.mail.on)}</ul>
    ${p ? boardPane(p) : acct === "mail" ? mail() : github()}</div>`;
}
function github() {
  return `<div class="apane">
      <div class="form">
        <span class="fl">${t("int.status")}</span><span class="status"><span class="sdot ${ghLogin ? "on" : ""}"></span>${ghLogin ? t("gh.connected", { login: esc(ghLogin) }) : esc(ghErr || t("gh.checking"))}</span>
        <span class="fl">${t("gh.sidebar")}</span><label class="chk"><input type="checkbox" id="ghon" ${settings.github.on ? "checked" : ""}> ${t("gh.show")}</label>
        <label class="fl" for="ghowners">${t("gh.owners")}</label><input class="field" id="ghowners" value="${esc(settings.github.owners)}" spellcheck="false" placeholder="${t("gh.ownersPh")}">
        <span></span><div class="hint">${t("gh.help")}</div>
      </div>
      <div class="setrow end">${ghMsg ? `<span class="${ghOk ? "okmsg" : "errmsg"}">${esc(ghMsg)}</span>` : ""}<button class="btn" data-set="ghcheck">${t("gh.recheck")}</button><button class="btn primary" data-set="ghsave">${t("set.save")}</button></div>
    </div>`;
}
// the form fields back into mailEdit, before anything redraws the pane
function mailSync() {
  const on = document.getElementById("mailon") as HTMLInputElement | null, sel = document.getElementById("mailacct") as HTMLSelectElement | null;
  for (const [id, k] of [["mailnew", "email"], ["mailpw", "pw"], ["mailemail2", "email"], ["mailsvc", "keychain_service"], ["mailkacc", "keychain_account"]] as const) { const f = document.getElementById(id) as HTMLInputElement | null; if (f && (f.value || id !== "mailemail2")) mailNew[k] = f.value; }
  if (on) mailEdit.on = on.checked;
  if (sel) mailEdit.account = sel.value;
}
// a backend error as what to do about it, with the raw message small below for when it is something else
function mailErr(e: string) {
  const k = /^Login failed/.test(e) ? "mail.errLogin" : /No password in the keychain/.test(e) ? "mail.errNoPw" : /not approved in time/.test(e) ? "mail.errKeychain"
    : /Only Gmail/.test(e) ? "mail.errGmail" : /IMAP (connection|timeout|protocol)/.test(e) ? "mail.errNet" : "";
  return k ? `${t(k)}<div class="hint">${esc(e)}</div>` : esc(e);
}
function mail() {
  const c = mailEdit, tr = (a: MailAcct) => { const r = mailTest[a.email]; return r === "busy" ? '<span class="spin"></span>' : r ? `<span class="${r.ok ? "okmsg" : "errmsg"}">${r.ok ? t("mail.testOk", { n: Number((r.text.match(/\d+/) || ["0"])[0]).toLocaleString(currentLocale()) }) : mailErr(r.text)}</span>` : ""; };
  const busy = (k: string) => mailBusy === k ? `<span class="spin"></span> ${t("mail.connecting")}` : "";
  return `<div class="apane">
      <div class="form">
        <span class="fl">${t("int.status")}</span><span class="status"><span class="sdot ${c.accounts.length ? "on" : ""}"></span>${t("mail.accounts", { n: c.accounts.length })}</span>
        <span class="fl">${t("gh.sidebar")}</span><label class="chk"><input type="checkbox" id="mailon" ${c.on ? "checked" : ""}> ${t("int.mailSidebar")}</label>
        ${c.accounts.length ? `<span class="fl">${t("mail.accountsH")}</span><div>${c.accounts.map(a => `<div class="mail-acct"><span>${esc(a.email)}</span><span class="hint">${t("mail.inKeychain", { svc: esc(a.keychain_service) })}</span>${tr(a)}<span class="sp"></span><button class="btn" data-set="mailtest" data-email="${esc(a.email)}">${t("mail.test")}</button><button class="btn" data-set="mailrm" data-email="${esc(a.email)}">${t("mail.remove")}</button></div>`).join("")}</div>
        ${c.accounts.length > 1 ? `<label class="fl" for="mailacct">${t("mail.account")}</label><select class="field" id="mailacct">${c.accounts.map(a =>
          `<option value="${esc(a.email)}" ${a.email === (c.account || c.accounts[0].email) ? "selected" : ""}>${esc(a.email)}</option>`).join("")}</select>` : ""}` : ""}
        <span></span><div class="hint">${t("mail.help")}</div>
      </div>
      <div class="setrow end">${mailMsg ? `<span class="${mailOk ? "okmsg" : "errmsg"}">${mailOk ? esc(mailMsg) : mailErr(mailMsg)}</span>` : ""}<button class="btn primary" data-set="mailsave">${t("set.save")}</button></div>
      <div class="mail-guide">
        <h3>${c.accounts.length ? t("mail.guideMore") : t("mail.guideH")}</h3>
        <div class="mail-step"><b>${t("mail.step1H")}</b><p>${t("mail.step1")}</p>
          <p><a class="btn" href="https://myaccount.google.com/apppasswords" target="_blank">${t("mail.step1Btn")}</a></p>
          <p class="hint">${t("mail.step1Hint")}</p></div>
        <div class="mail-step"><b>${t("mail.step2H")}</b>
          <div class="form">
            <label class="fl" for="mailnew">${t("mail.emailL")}</label><input class="field" id="mailnew" type="email" value="${esc(mailNew.email)}" placeholder="naam@bedrijf.be" spellcheck="false" autocomplete="off">
            <label class="fl" for="mailpw">${t("mail.pwL")}</label><input class="field" id="mailpw" type="password" value="${esc(mailNew.pw)}" placeholder="${t("mail.pwPh")}" autocomplete="off" spellcheck="false">
            <span></span><div class="mail-acct"><button class="btn primary" data-set="mailconnect" ${mailBusy ? "disabled" : ""}>${t("mail.connect")}</button>${busy("connect")}</div>
            <span></span><div class="hint">${t("mail.step2Hint")}</div>
          </div></div>
        <details class="mail-step"${mailNew.keychain_service ? " open" : ""}><summary>${t("mail.advH")}</summary>
          <p class="hint">${t("mail.adv")}</p>
          <div class="form">
            <label class="fl" for="mailemail2">${t("mail.emailL")}</label><input class="field" id="mailemail2" type="email" value="${esc(mailNew.email)}" placeholder="naam@bedrijf.be" spellcheck="false" autocomplete="off">
            <label class="fl" for="mailsvc">${t("mail.svcL")}</label><input class="field" id="mailsvc" value="${esc(mailNew.keychain_service)}" placeholder="himalaya-weareantenna-imap" spellcheck="false">
            <label class="fl" for="mailkacc">${t("mail.kaccL")}</label><input class="field" id="mailkacc" value="${esc(mailNew.keychain_account)}" placeholder="weareantenna" spellcheck="false">
            <span></span><div class="mail-acct"><button class="btn" data-set="mailadd" ${mailBusy ? "disabled" : ""}>${t("mail.addTest")}</button>${busy("advanced")}</div>
          </div></details>
      </div>
    </div>`;
}
// one board provider: switched on for the sidebar, the token, the fields of its config
function boardPane(p: BoardProvider) {
  const cfg = settings.integrations[p.id] || {}, ready = setUp(p), has = tokens[p.id], m = pmsg[p.id], id = esc(p.id);
  return `<div class="apane">
      <div class="form">
        <span class="fl">${t("int.status")}</span><span class="status"><span class="sdot ${ready ? "on" : ""}"></span>${ready ? t("int.set") : t("int.notSet")}</span>
        <span class="fl">${t("int.sidebar")}</span><label class="chk"><input type="checkbox" id="on-${id}" ${cfg.on !== false ? "checked" : ""}> ${t("int.showBoard")}</label>
        <label class="fl" for="tok-${id}">${pt(p, p.settings.tokenLabel)}</label><input class="field" id="tok-${id}" type="password" autocomplete="off" spellcheck="false" placeholder="${has ? t("int.tokenStored") : t("int.tokenPaste")}">
        ${p.settings.fields.map(f => f.check
          ? `<span class="fl">${pt(p, f.label)}</span><label class="chk"><input type="checkbox" id="f-${id}-${esc(f.key)}" ${cfg[f.key] ? "checked" : ""}> ${f.placeholder ? pt(p, f.placeholder) : ""}</label>`
          : `<label class="fl" for="f-${id}-${esc(f.key)}">${pt(p, f.label)}</label><input class="field" id="f-${id}-${esc(f.key)}"${f.numeric ? ' inputmode="numeric"' : ""}${f.secret
            ? ` type="password" autocomplete="off" placeholder="${has ? t("int.tokenStored") : t("int.tokenPaste")}"`
            : ` value="${esc(cfg[f.key] ?? "")}"${f.placeholder ? ` placeholder="${pt(p, f.placeholder)}"` : ""}`} spellcheck="false">`).join("\n        ")}
        <span></span><div class="hint">${pt(p, p.settings.help)}</div>
      </div>
      <div class="setrow">${p.settings.import ? `<button class="btn" data-set="bimport">${pt(p, p.settings.import.label)}</button>` : ""}${has ? `<button class="btn" data-set="bclear">${t("int.clear")}</button>` : ""}</div>
      <div class="setrow end">${m ? `<span class="${m.ok ? "okmsg" : "errmsg"}">${esc(m.text)}</span>` : ""}<button class="btn primary" data-set="bsave">${t("int.save")}</button></div>
      ${boardMap(p)}
    </div>`;
}
async function ghCheck() {
  ghLogin = ""; ghErr = ""; render();
  try { ghLogin = await invoke<string>("github_status"); } catch (e) { ghErr = String(e); }
  render();
}

// language names stay in their own language, so they are findable whatever the app is set to
const LANG_OPTS = () => [["system", t("set.system")], ["en", "English"], ["nl", "Nederlands"], ["fr", "Français"], ["de", "Deutsch"]];
function render() {
  const cur = TABS.find(x => x[0] === tab)!;
  root.innerHTML = `<nav class="ptabs">${TABS.map(([id, name, g]) => `<button class="ptab${id === tab ? " on" : ""}" data-tab="${id}">${icon(g)}<span>${t(name)}</span></button>`).join("")}</nav>
    <section class="ppane">${tab === "general" ? general() : tab === "projects" ? projects() : integrations()}</section>`;
  getCurrentWindow().setTitle(t(cur[1])).catch(() => {});
  document.title = t(cur[1]);
}
const go = (to: Tab) => { tab = to; localStorage.setItem("prefsTab", to); msg = ""; render(); };
// saves the token and the config, then one call to the provider to show they work together
async function boardSave(p: BoardProvider, cfg: Record<string, any>, secrets: Record<string, string> = {}) {
  try {
    for (const [account, token] of Object.entries(secrets)) if (token) await invoke("integration_token", { provider: p.id, token, account });
    tokens[p.id] = await invoke<boolean>("integration_has_token", { provider: p.id });
    settings = await invoke<Settings>("set_settings", { settings: { ...settings, integrations: { ...settings.integrations, [p.id]: cfg } } });
    pmsg[p.id] = { text: await p.settings.test(ctxOf(p, settings.integrations)), ok: true };
    delete allBoards[p.id];
  } catch (e) { pmsg[p.id] = { text: String(e), ok: false }; }
  render();
}
async function save(next: Settings, done: string) {
  try { settings = await invoke<Settings>("set_settings", { settings: next }); vs = await invoke<VaultStatus>("vault_status"); msg = done; ok = true; }
  catch (e) { msg = String(e); ok = false; }
  render();
}
root.addEventListener("click", async e => {
  // a web link (Google's app password page) opens in the browser, the settings window never navigates
  const link = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[href^='https:']");
  if (link) { e.preventDefault(); invoke("plugin:opener|open_url", { url: link.href }); return; }
  const tb = (e.target as HTMLElement).closest<HTMLElement>("[data-tab]");
  if (tb) { go(tb.dataset.tab as Tab); return; }
  const a = (e.target as HTMLElement).closest<HTMLElement>("[data-acct]");
  if (a) { acct = a.dataset.acct!; localStorage.setItem("prefsAcct", acct); render(); return; }
  const b = (e.target as HTMLElement).closest<HTMLElement>("[data-set]"); if (!b) return;
  const val = (id: string) => (document.getElementById(id) as HTMLInputElement).value.trim();
  if (b.dataset.set === "pick") { vs = (await pickVault()) ?? vs; msg = ""; render(); }
  if (b.dataset.set === "pickmap") { vs = await pickMapped(vs, b.dataset.k as MapKey, readMapping(root, vs)); render(); }
  if (b.dataset.set === "save") await save({ ...settings, vault: vs.vault, vaults: { ...settings.vaults, [vs.vault]: readMapping(root, vs) } }, t("set.saved"));
  if (b.dataset.set === "ghcheck") ghCheck();
  if (b.dataset.set === "ghsave") {
    const next = { ...settings, github: { on: (document.getElementById("ghon") as HTMLInputElement).checked, owners: val("ghowners") } };
    try { settings = await invoke<Settings>("set_settings", { settings: next }); ghMsg = t("set.saved"); ghOk = true; }
    catch (x) { ghMsg = String(x); ghOk = false; }
    render();
  }
  if (b.dataset.set?.startsWith("mail")) {
    mailSync();
    const em = b.dataset.email ?? "";
    if (b.dataset.set === "mailrm") { delete mailTest[em]; mailEdit.accounts = mailEdit.accounts.filter(a => a.email !== em); if (mailEdit.account === em) mailEdit.account = ""; }
    // add an account that passed its test and save at once, so nothing is left half set up
    const keep = async (a: MailAcct, result: string) => {
      mailEdit.accounts = [...mailEdit.accounts.filter(x => x.email.toLowerCase() !== a.email.toLowerCase()), a];
      settings = await invoke<Settings>("set_settings", { settings: { ...settings, mail: { ...mailEdit, on: true } } });
      mailEdit = { ...settings.mail, accounts: settings.mail?.accounts ?? [] };
      mailTest[a.email] = { text: result, ok: true };
      mailMsg = t("mail.connected", { email: a.email, n: (result.match(/\d+/) || ["?"])[0] }); mailOk = true;
      mailNew.email = mailNew.pw = mailNew.keychain_service = mailNew.keychain_account = "";
    };
    if (b.dataset.set === "mailconnect") {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mailNew.email.trim())) { mailMsg = t("mail.invalid"); mailOk = false; render(); return; }
      mailBusy = "connect"; mailMsg = ""; render();
      try { const r = await invoke<{ account: MailAcct; result: string }>("mail_connect", { email: mailNew.email, password: mailNew.pw }); await keep(r.account, r.result); }
      catch (x) { mailMsg = String(x); mailOk = false; }
      mailBusy = ""; mailNew.pw = "";
    }
    if (b.dataset.set === "mailadd") {
      const a = { email: mailNew.email.trim(), keychain_service: mailNew.keychain_service.trim(), keychain_account: mailNew.keychain_account.trim() };
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email) || !a.keychain_service || !a.keychain_account) { mailMsg = t("mail.invalid"); mailOk = false; render(); return; }
      mailBusy = "advanced"; mailMsg = ""; render();
      try { await keep(a, await invoke<string>("mail_test", { account: a })); }
      catch (x) { mailMsg = String(x); mailOk = false; }
      mailBusy = "";
    }
    if (b.dataset.set === "mailtest") {
      const a = mailEdit.accounts.find(x => x.email === em); if (!a) return;
      mailTest[em] = "busy"; render();
      try { mailTest[em] = { text: await invoke<string>("mail_test", { account: a }), ok: true }; } catch (x) { mailTest[em] = { text: String(x), ok: false }; }
      mailSync();
    }
    if (b.dataset.set === "mailsave") {
      try { settings = await invoke<Settings>("set_settings", { settings: { ...settings, mail: mailEdit } }); mailEdit = { ...settings.mail, accounts: settings.mail?.accounts ?? [] }; mailMsg = t("set.saved"); mailOk = true; }
      catch (x) { mailMsg = String(x); mailOk = false; }
    }
    render();
  }
  const bp = provider(acct);
  if (bp && b.dataset.set === "bsave") {
    const cfg: Record<string, any> = { ...settings.integrations[bp.id], on: (document.getElementById(`on-${bp.id}`) as HTMLInputElement).checked };
    const secrets: Record<string, string> = { token: val(`tok-${bp.id}`) };
    for (const f of bp.settings.fields) {
      if (f.check) cfg[f.key] = (document.getElementById(`f-${bp.id}-${f.key}`) as HTMLInputElement).checked;
      else if (f.secret) secrets[f.key] = val(`f-${bp.id}-${f.key}`);
      else cfg[f.key] = val(`f-${bp.id}-${f.key}`);
    }
    pmsg[bp.id] = { text: t("int.busy"), ok: true }; render();
    await boardSave(bp, cfg, secrets);
  }
  if (bp?.settings.import && b.dataset.set === "bimport") {
    try { const r = await bp.settings.import.run(); await boardSave(bp, { ...settings.integrations[bp.id], ...r }); }
    catch (e) { pmsg[bp.id] = { text: String(e), ok: false }; render(); }
  }
  if (bp && b.dataset.set === "bclear") {
    await invoke("integration_token", { provider: bp.id, token: "" }); tokens[bp.id] = false; delete allBoards[bp.id]; pmsg[bp.id] = { text: t("int.cleared"), ok: true }; render();
  }
  if (b.dataset.set === "clear") { const next = structuredClone(settings); delete next.projects[b.dataset.p!]; await save(next, t("set.restored")); }
});
// the language applies right away: saved, then this window and the main one redraw in it
root.addEventListener("change", async e => {
  const bm = (e.target as HTMLElement).closest<HTMLSelectElement>("[data-bmap]"), bp = provider(acct);
  if (bm && bp) {
    // a vault project has at most one board: picking one replaces what it had, None only drops this provider's
    const vp = bm.dataset.bmap!, boards = { ...settings.boards }, [project, board] = bm.value.split("/");
    if (board) boards[vp] = { provider: bp.id, project, board }; else if (boards[vp]?.provider === bp.id) delete boards[vp]; else return;
    try { settings = await invoke<Settings>("set_settings", { settings: { ...settings, boards } }); pmsg[bp.id] = { text: t("set.saved"), ok: true }; }
    catch (x) { pmsg[bp.id] = { text: String(x), ok: false }; }
    render(); return;
  }
  if ((e.target as HTMLElement).matches("[data-map]")) { vs = await checkMapping(vs.vault, readMapping(root, vs)); render(); return; }
  const fav = (e.target as HTMLElement).closest<HTMLInputElement>("#favon");
  if (fav) { await save({ ...settings, favicons: { last: "", tried: {}, ...settings.favicons, on: fav.checked } }, ""); return; }
  const sel = (e.target as HTMLElement).closest<HTMLSelectElement>("#language"); if (!sel) return;
  await save({ ...settings, language: sel.value }, "");
  await initI18n(); render();
});
window.addEventListener("keydown", e => {
  if (e.key === "Escape" || (e.metaKey && e.key === "w")) window.close();
  // Cmd-1, 2, 3 jump to a tab
  const n = e.metaKey && !e.altKey && !e.shiftKey ? Number(e.key) : 0;
  if (n >= 1 && n <= TABS.length) { e.preventDefault(); go(TABS[n - 1][0]); }
});
render();
ghCheck();
