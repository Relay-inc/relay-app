import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./settings.css";
import { currentLocale, initI18n, pt, t, tn, at } from "./i18n";
import type { Key } from "./locales/en";
import { PROVIDERS, provider, ctxOf, type BoardOpt, type BoardProvider, type BoardRef } from "./providers";
import { agent, agentsStatus, type AgentsStatus, type AgentStatus } from "./agents";
import { KEYS, readMapping, pickVault, pickMapped, checkMapping, type VaultStatus, type VaultMap, type MapKey } from "./vault-setup";
import { iconPaths } from "./icons";
import { loadIcons, setIcon, iconFrom, iconImg, isSite, type ProjectIcon, type IconKind } from "./project-icons";
import { listen } from "@tauri-apps/api/event";

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
// agents: what the backend detects per provider (installed, version, login), checked when the window opens
let agSt: AgentsStatus | null = null, agMsg = "", agOk = false;
// the lists of agents and integrations: which Add menu is open, which rows are folded open ("ag:claude", "int:github")
let menu: "" | "ag" | "int" = "";
const opened = new Set<string>();
let intMsg = "", intOk = false;

const G: Record<string, string> = {
  // GitHub's mark (octicon mark-github), in the label colour
  gh: '<path transform="translate(4 4)" fill="currentColor" stroke="none" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>',
};
const icon = (n: string) => `<svg viewBox="0 0 24 24">${G[n] ?? iconPaths(n)}</svg>`;
// a provider's 16×16 glyph on the 24×24 tile
const pIcon = (p: BoardProvider) => `<svg viewBox="0 0 24 24"><g transform="scale(1.5)">${p.glyph}</g></svg>`;
const TABS = [["general", "set.tab.general", "gear"], ["projects", "set.tab.projects", "folder"], ["agents", "set.tab.agents", "agent"], ["integrations", "set.tab.integrations", "plug"]] as const satisfies readonly (readonly [string, Key, string])[];
type Tab = typeof TABS[number][0];
let tab: Tab = (TABS.find(x => x[0] === localStorage.getItem("prefsTab"))?.[0]) ?? "general";

// the building blocks (settings.css): a section is a title and hint above a card, a field a label with its control
const nc = (s: string) => s.replace(/\s*:\s*$/, ""); // the form labels end in a colon, the fields do without
type SecOpts = { desc?: string; icon?: string; action?: string; foot?: string; list?: boolean };
const sec = (title: string, body: string, o: SecOpts = {}) =>
  `<section class="ss"><header class="ss-h"><div class="ss-t">${o.icon ? `<span class="ptile">${o.icon}</span>` : ""}<div><h2>${title}</h2>${o.desc ? `<p>${o.desc}</p>` : ""}</div></div>${o.action ? `<div class="ss-a">${o.action}</div>` : ""}</header>
    ${body ? `<div class="ss-card${o.list ? " list" : ""}">${body}</div>` : ""}${o.foot ? `<div class="ss-foot">${o.foot}</div>` : ""}</section>`;
const field = (label: string, ctl: string, o: { hint?: string; id?: string; below?: boolean } = {}) =>
  `<div class="sf${o.below ? " below" : ""}${o.hint ? " top" : ""}"><div class="sf-l">${o.id ? `<label for="${o.id}">${label}</label>` : `<span>${label}</span>`}${o.hint ? `<p class="sf-h">${o.hint}</p>` : ""}</div><div class="sf-c">${ctl}</div></div>`;
const sw = (id: string, on: boolean) => `<input type="checkbox" class="sw" role="switch" id="${id}" ${on ? "checked" : ""}>`;
const st = (state: "ok" | "warn" | "off", text: string) => `<span class="st"><span class="sd ${state === "off" ? "" : state}"></span>${text}</span>`;
// a path with its folder button inside the field, and a dot for whether the app found it
const pick = (input: string, btn: string, found?: boolean | null, wide = false) =>
  `<div class="pick${wide ? " wide" : ""}">${found == null ? "" : `<span class="sd ${found ? "ok" : "warn"}" title="${t(found ? "vault.found" : "vault.missing")}"></span>`}${input}<button class="pick-b" ${btn} title="${t("vault.pickPath")}">${icon("folder")}</button></div>`;
// a row of a list that folds open to its settings, and the Add menu with what is not in the list yet
const foldRow = (kind: string, id: string, ico: string, name: string, state: string, body: () => string) => {
  const open = opened.has(`${kind}:${id}`);
  return `<div class="arow${open ? " open" : ""}"><button class="arow-h" data-set="fold" data-kind="${kind}" data-id="${esc(id)}" aria-expanded="${open}">
      <span class="srow-i">${ico}</span><span class="srow-t"><b>${name}</b>${state}</span>
      <svg class="chev" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg></button>${open ? `<div class="arow-b">${body()}</div>` : ""}</div>`;
};
const addMenu = (kind: "ag" | "int", label: string, items: { id: string; ico: string; name: string; state: string }[]) => !items.length ? "" :
  `<div class="menu-w"><button class="btn" data-set="menu" data-kind="${kind}" aria-expanded="${menu === kind}">${label}</button>${menu === kind ? `<div class="menu">${items.map(x =>
    `<button class="menu-i" data-set="add" data-kind="${kind}" data-id="${esc(x.id)}"><span class="ptile">${x.ico}</span><span class="menu-t"><b>${x.name}</b>${x.state}</span></button>`).join("")}</div>` : ""}</div>`;
const removeBtn = (kind: string, id: string) => `<button class="btn ghost" data-set="remove" data-kind="${kind}" data-id="${esc(id)}">${t("ag.remove")}</button>`;
// a message on the left, the buttons on the right
const foot = (m: string, good: boolean, buttons: string) => `${m ? `<span class="${good ? "okmsg" : "errmsg"}">${m}</span>` : ""}<span class="sp"></span>${buttons}`;

function general() {
  const maps = KEYS.map(([k, , req]) => field(`${t(`vault.k.${k}` as Key)}${req ? "" : ` <span class="opt">${t("vault.optional")}</span>`}`,
    pick(`<input class="field" data-map="${k}" value="${esc(vs.map[k])}" title="${esc(vs.map[k])}" spellcheck="false">`, `data-set="pickmap" data-k="${k}"`, req || vs.map[k] ? vs.found[k] : null),
    { hint: t(`vault.h.${k}` as Key) })).join("");
  return sec(nc(t("set.vaultLabel")), pick(`<input class="field" id="vaultpath" value="${esc(vs.vault)}" title="${esc(vs.vault)}" placeholder="${t("vault.none")}" readonly spellcheck="false">`, 'data-set="pick"', null, true),
      { desc: t("set.vaultHelp") })
    + sec(t("set.sec.folders"), maps, { desc: t("vault.mapHelp"), foot: foot(msg && esc(msg), ok, `<button class="btn primary" data-set="save">${t("set.save")}</button>`) })
    + sec(t("set.sec.interface"),
      field(t("set.language"), `<select class="field" id="language">${LANG_OPTS().map(([v, name]) =>
        `<option value="${v}" ${(settings.language || "system") === v ? "selected" : ""}>${esc(name)}</option>`).join("")}</select>`, { id: "language", hint: t("set.languageHelp") })
      + field(t("set.faviconsOn"), sw("favon", settings.favicons?.on !== false), { id: "favon", hint: t("set.faviconsHelp") }));
}
// the project icons live in the vault (.relay/config.json, src/project-icons.ts): every project, folded, to override
let icons: Record<string, ProjectIcon> | null = null, iconNames: string[] = [], iconMsg = "", iconOk = false, finding = false;
let repos: Record<string, string[]> = {};
let iconProjects: { name: string; context?: string; summary?: string }[] = [];
async function loadIconsPane() {
  const [i, snap, rp] = await Promise.all([loadIcons(), invoke<any>("snapshot").catch(() => ({ projects: [] })), invoke<Record<string, string[]>>("project_repos").catch(() => ({}))]);
  icons = i; repos = rp; iconProjects = snap.projects || [];
  iconNames = iconProjects.map(x => String(x.name)).sort((a, b) => a.localeCompare(b));
  render();
}
listen("icons-changed", () => { if (icons) loadIconsPane(); });
// the Projects page: every project, a row folds open to its configuration. The name in Relay stays in the app's
// settings; the icon and the repos live in the vault's .relay/config.json.
function projects() {
  if (!icons) { queueMicrotask(loadIconsPane); return sec(t("set.tab.projects"), `<div class="st"><span class="spin"></span>${t("pr.loading")}</div>`); }
  const preview = (n: string) => iconImg(icons?.[n]?.img, "") || (icons?.[n]?.icon ? `<span class="emo">${esc(icons[n].icon!)}</span>` : icon("folder"));
  const ctx = (n: string) => iconProjects.find(p => p.name === n)?.context ?? "";
  const title = (n: string) => { const l = settings.projects[n]?.label; return l ? `${esc(l)} <span class="opt">${esc(n)}</span>` : esc(n); };
  const state = (n: string) => `<span class="st">${[ctx(n), repos[n]?.length ? tn("pc.repoCount", repos[n].length) : ""].filter(Boolean).map(esc).join(" · ")}</span>`;
  const body = (n: string) => { const i = icons?.[n], id = esc(n);
    // one input for an emoji or a website; the buttons for an image, none and guessing again
    const val = i?.icon ?? (i && isSite(i.value) ? i.value : "");
    return `${field(t("pc.name"), `<input class="field" data-plabel="${id}" value="${esc(settings.projects[n]?.label ?? "")}" placeholder="${id}" spellcheck="false">`)}
      ${field(t("pc.icon"), `<span class="iconctl"><span class="itile">${preview(n)}</span><input class="field" data-picon="${id}" value="${esc(val)}" placeholder="${t("pc.iconPh")}" spellcheck="false">
        <label class="btn ib" title="${t("pi.upload")}">${icon("upload")}<input type="file" data-pifile="${id}" accept="image/*,.ico,.svg" hidden></label>
        <button class="btn ib" data-set="piset" data-kind-icon="none" data-id="${id}" title="${t("pi.none")}">${icon("none")}</button>
        <button class="btn ib" data-set="piset" data-kind-icon="reset" data-id="${id}" title="${t("pi.reset")}">${icon("refresh")}</button></span>`, { hint: iconHint(n) })}
      ${field(t("pc.repos"), `<span class="chips">${(repos[n] ?? []).map(r => `<span class="chip">${esc(r)}<button data-set="repodel" data-id="${id}" data-repo="${esc(r)}" title="${t("ag.remove")}">×</button></span>`).join("")}
        <input class="field" data-repoadd="${id}" placeholder="owner/repo" spellcheck="false"></span>`, { hint: t("pc.reposHelp") })}`; };
  return sec(t("set.tab.projects"), iconNames.map(n => foldRow("proj", n, preview(n), title(n), state(n), () => body(n))).join("") || `<div class="sempty">${t("set.none")}</div>`,
    { desc: t("pc.desc"), list: true, foot: iconMsg || msg ? foot(esc(iconMsg || msg), iconMsg ? iconOk : ok, "") : "",
      action: `<button class="btn" data-set="pifind" title="${t("pi.findHelp")}" ${finding ? "disabled" : ""}>${finding ? `<span class="spin"></span> ${t("pi.finding")}` : t("pi.find")}</button>` });
}
// what the icon is now, under the icon line
function iconHint(n: string) {
  const i = icons?.[n];
  if (!i) return t("pi.guess");
  if (i.img) return t("pi.image");
  if (i.icon) return t("pi.emoji");
  if (isSite(i.value)) return settings.favicons?.tried?.[n] === i.value ? t("pi.siteNoIcon", { site: esc(i.value) }) : t("pi.siteSoon", { site: esc(i.value) });
  return t("pi.noIcon");
}
async function setRepos(project: string, list: string[]) {
  try { await invoke("set_project_repos", { project, repos: list }); iconMsg = ""; iconOk = true; repos = await invoke<Record<string, string[]>>("project_repos"); }
  catch (x) { iconMsg = String(x); iconOk = false; }
  render();
}
// Find icons: Claude looks up the website of every project without an icon (or set to none), its favicon follows
async function findIcons() {
  const targets = iconProjects.filter(p => { const i = icons?.[p.name]; return !i || i.value === ""; });
  if (!targets.length) { iconMsg = t("pi.findNone"); iconOk = true; render(); return; }
  finding = true; iconMsg = ""; render();
  try {
    const found = await invoke<Record<string, string>>("find_icon_sites", { projects: targets.map(p => ({ name: p.name, context: p.context ?? "", summary: p.summary ?? "" })) });
    for (const [n, site] of Object.entries(found)) await setIcon(n, "site", site);
    const n = Object.keys(found).length;
    iconMsg = n ? t("pi.found", { n, total: targets.length }) : t("pi.findNone"); iconOk = true;
  } catch (x) { iconMsg = String(x); iconOk = false; }
  finding = false; render();
}
async function iconSet(project: string, kind: IconKind, value = "") {
  try { await setIcon(project, kind, value); iconMsg = ""; iconOk = true; } catch (x) { iconMsg = String(x); iconOk = false; render(); }
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
  return `<div class="sub"><b>${t("int.boards")}</b><p class="hint">${t("int.boardsHelp")}</p></div>`
    + (vaultProjects || []).map(vp => field(esc(vp), `<select class="field" data-bmap="${esc(vp)}" data-bp="${esc(p.id)}">${opts(vp)}</select>`)).join("");
}
// the integrations: the ones in use are listed (a board provider set up or added, GitHub and Mail switched on), the
// others are in the Add menu. In the list means in the sidebar; Remove switches it off and keeps the token.
const ghState = () => st(ghLogin ? "ok" : ghErr ? "warn" : "off", ghLogin ? t("gh.connected", { login: esc(ghLogin) }) : esc(ghErr || t("gh.checking")));
const mailState = () => st(mailEdit.accounts.length ? "ok" : "off", t("mail.accounts", { n: mailEdit.accounts.length }));
const boardState = (p: BoardProvider) => st(setUp(p) ? "ok" : "off", setUp(p) ? t("int.set") : t("int.notSet"));
const boardOn = (p: BoardProvider) => { const on = settings.integrations[p.id]?.on; return on === true || (on === undefined && setUp(p)); };
function integrations() {
  const all = [
    ...PROVIDERS.map(p => ({ id: p.id, ico: pIcon(p), name: esc(p.name), state: boardState(p), on: boardOn(p), body: () => boardBody(p) })),
    { id: "github", ico: icon("gh"), name: "GitHub", state: ghState(), on: !!settings.github.on, body: github },
    { id: "mail", ico: icon("mail"), name: "Mail", state: mailState(), on: !!settings.mail?.on, body: mail },
  ];
  const act = all.filter(x => x.on);
  return sec(t("set.tab.integrations"), act.length ? act.map(x => foldRow("int", x.id, x.ico, x.name, x.state, x.body)).join("") : `<div class="sempty">${t("int.empty")}</div>`,
    { desc: t("int.listHelp"), action: addMenu("int", t("int.add"), all.filter(x => !x.on)), list: true, foot: intMsg ? foot(esc(intMsg), intOk, "") : "" });
}
function github() {
  return `<p class="hint">${t("gh.help")}</p>
    ${field(nc(t("gh.owners")), `<input class="field" id="ghowners" value="${esc(settings.github.owners)}" spellcheck="false" placeholder="${t("gh.ownersPh")}">`, { id: "ghowners" })}
    <div class="ss-foot">${removeBtn("int", "github")}${foot(ghMsg && esc(ghMsg), ghOk, `<button class="btn" data-set="ghcheck">${t("gh.recheck")}</button><button class="btn primary" data-set="ghsave">${t("set.save")}</button>`)}</div>`;
}
// the form fields back into mailEdit, before anything redraws the pane
function mailSync() {
  const sel = document.getElementById("mailacct") as HTMLSelectElement | null;
  for (const [id, k] of [["mailnew", "email"], ["mailpw", "pw"], ["mailemail2", "email"], ["mailsvc", "keychain_service"], ["mailkacc", "keychain_account"]] as const) { const f = document.getElementById(id) as HTMLInputElement | null; if (f && (f.value || id !== "mailemail2")) mailNew[k] = f.value; }
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
  const accts = c.accounts.map(a => `<div class="srow"><span class="srow-t"><b>${esc(a.email)}</b><span>${t("mail.inKeychain", { svc: esc(a.keychain_service) })}</span></span>${tr(a)}
    <span class="srow-x"><button class="btn" data-set="mailtest" data-email="${esc(a.email)}">${t("mail.test")}</button><button class="btn ghost" data-set="mailrm" data-email="${esc(a.email)}">${t("mail.remove")}</button></span></div>`).join("");
  return `<p class="hint">${t("mail.help")}</p>
    ${accts ? `<div class="sub"><b>${t("mail.accountsH")}</b></div><div class="slist">${accts}</div>` : ""}
    ${c.accounts.length > 1 ? field(nc(t("mail.account")), `<select class="field" id="mailacct">${c.accounts.map(a =>
      `<option value="${esc(a.email)}" ${a.email === (c.account || c.accounts[0].email) ? "selected" : ""}>${esc(a.email)}</option>`).join("")}</select>`, { id: "mailacct" }) : ""}
    <div class="ss-foot">${removeBtn("int", "mail")}${foot(mailMsg && (mailOk ? esc(mailMsg) : mailErr(mailMsg)), mailOk, `<button class="btn primary" data-set="mailsave">${t("set.save")}</button>`)}</div>
    <div class="sub"><b>${c.accounts.length ? t("mail.guideMore") : t("mail.guideH")}</b></div>
    <div class="mstep"><b>${t("mail.step1H")}</b><p>${t("mail.step1")}</p>
      <a class="btn" href="https://myaccount.google.com/apppasswords" target="_blank">${t("mail.step1Btn")}</a>
      <p class="hint">${t("mail.step1Hint")}</p></div>
    <div class="mstep"><b>${t("mail.step2H")}</b>
      ${field(nc(t("mail.emailL")), `<input class="field" id="mailnew" type="email" value="${esc(mailNew.email)}" placeholder="naam@bedrijf.be" spellcheck="false" autocomplete="off">`, { id: "mailnew" })}
      ${field(nc(t("mail.pwL")), `<input class="field" id="mailpw" type="password" value="${esc(mailNew.pw)}" placeholder="${t("mail.pwPh")}" autocomplete="off" spellcheck="false">`, { id: "mailpw" })}
      <div class="setrow"><button class="btn primary" data-set="mailconnect" ${mailBusy ? "disabled" : ""}>${t("mail.connect")}</button>${busy("connect")}</div>
      <p class="hint">${t("mail.step2Hint")}</p></div>
    <details class="mstep"${mailNew.keychain_service ? " open" : ""}><summary>${t("mail.advH")}</summary>
      <p class="hint">${t("mail.adv")}</p>
      ${field(nc(t("mail.emailL")), `<input class="field" id="mailemail2" type="email" value="${esc(mailNew.email)}" placeholder="naam@bedrijf.be" spellcheck="false" autocomplete="off">`, { id: "mailemail2" })}
      ${field(nc(t("mail.svcL")), `<input class="field" id="mailsvc" value="${esc(mailNew.keychain_service)}" placeholder="himalaya-weareantenna-imap" spellcheck="false">`, { id: "mailsvc" })}
      ${field(nc(t("mail.kaccL")), `<input class="field" id="mailkacc" value="${esc(mailNew.keychain_account)}" placeholder="weareantenna" spellcheck="false">`, { id: "mailkacc" })}
      <div class="setrow"><button class="btn" data-set="mailadd" ${mailBusy ? "disabled" : ""}>${t("mail.addTest")}</button>${busy("advanced")}</div>
    </details>`;
}
// one board provider: the token, the fields of its config, its boards per vault project
function boardBody(p: BoardProvider) {
  const cfg = settings.integrations[p.id] || {}, has = tokens[p.id], m = pmsg[p.id], id = esc(p.id);
  const secretPh = `type="password" autocomplete="off" placeholder="${has ? t("int.tokenStored") : t("int.tokenPaste")}"`;
  const fields = p.settings.fields.map(f => { const fid = `f-${id}-${esc(f.key)}`;
    return f.check ? field(f.placeholder ? pt(p, f.placeholder) : pt(p, f.label), sw(fid, !!cfg[f.key]), { id: fid })
      : field(nc(pt(p, f.label)), `<input class="field" id="${fid}"${f.numeric ? ' inputmode="numeric"' : ""} ${f.secret ? secretPh
        : `value="${esc(cfg[f.key] ?? "")}"${f.placeholder ? ` placeholder="${pt(p, f.placeholder)}"` : ""}`} spellcheck="false">`, { id: fid }); }).join("");
  const extra = (p.settings.import ? `<button class="btn" data-set="bimport" data-id="${id}">${pt(p, p.settings.import.label)}</button>` : "") + (has ? `<button class="btn ghost" data-set="bclear" data-id="${id}">${t("int.clear")}</button>` : "");
  return `<p class="hint">${pt(p, p.settings.help)}</p>
    ${field(nc(pt(p, p.settings.tokenLabel)), `<input class="field" id="tok-${id}" ${secretPh} spellcheck="false">`, { id: `tok-${id}` })}
    ${fields}
    <div class="ss-foot">${removeBtn("int", p.id)}${extra}${foot(m ? esc(m.text) : "", !!m?.ok, `<button class="btn primary" data-set="bsave" data-id="${id}">${t("int.save")}</button>`)}</div>
    ${boardMap(p)}`;
}
// the agents: only the ones switched on are listed, the others are in the Add menu. A row folds open to its
// program and options. Every change saves at once.
const agCfg = (id: string) => settings.agents?.providers[id] ?? { on: false, bin: "" };
const agGlyph = (id: string) => { const ap = agent(id); return ap ? `<svg viewBox="0 0 16 16">${ap.glyph}</svg>` : ""; };
function agState(p: AgentStatus) {
  const d = p.detect;
  const found = d.installed ? (d.version ? t("ag.installed", { version: esc(d.version) }) : t("ag.installedNoVersion")) : t("ag.missing", { bin: esc(d.bin) });
  const login = d.loggedIn == null ? "" : ` · ${d.loggedIn ? t("ag.loggedIn") : t("ag.loggedOut")}`;
  return st(!d.installed ? "off" : d.loggedIn === false ? "warn" : "ok", found + login);
}
function agents() {
  if (!agSt) return sec(t("set.tab.agents"), `<div class="st"><span class="spin"></span>${agMsg ? esc(agMsg) : t("ag.checking")}</div>`);
  const act = agSt.providers.filter(p => agCfg(p.id).on), rest = agSt.providers.filter(p => !agCfg(p.id).on);
  const add = addMenu("ag", t("ag.add"), rest.map(p => ({ id: p.id, ico: agGlyph(p.id), name: esc(p.name), state: agState(p) })));
  return sec(t("set.tab.agents"), act.length ? act.map(p => foldRow("ag", p.id, agGlyph(p.id),
        `${esc(p.name)}${settings.agents?.default === p.id ? ` <span class="pill">${t("ag.isDefault")}</span>` : ""}`, agState(p), () => agentBody(p))).join("") : `<div class="sempty">${t("ag.empty")}</div>`,
      { desc: t("ag.listHelp"), action: `<button class="btn ghost" data-set="agcheck">${t("ag.recheck")}</button>${add}`, list: true, foot: agMsg ? foot(esc(agMsg), agOk, "") : "" })
    // with one agent there is nothing to choose
    + (act.length > 1 ? sec(t("ag.default"), "", { desc: t("ag.defaultHelp"), action: `<select class="field" id="agdefault" aria-label="${t("ag.default")}">${act.map(p =>
        `<option value="${esc(p.id)}" ${settings.agents?.default === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>` }) : "");
}
function agentBody(p: AgentStatus) {
  const cfg = agCfg(p.id), d = p.detect, ap = agent(p.id), id = esc(p.id);
  const caps = (["images", "permissions", "questions", "subagents", "terminal", "limits", "effort"] as const).filter(c => p.caps[c]).map(c => `<span class="pill">${t(`ag.cap.${c}`)}</span>`).join("");
  return `${ap ? `<p class="hint">${at(ap, "set.help")}</p>` : ""}
    ${field(nc(t("ag.bin")), `<input class="field" id="agbin-${id}" data-agbin="${id}" value="${esc(cfg.bin)}" placeholder="${t("ag.binPh", { bin: esc(p.defaultBin) })}" spellcheck="false">`, { id: `agbin-${id}`, hint: d.note ? `<code>${esc(d.note)}</code>` : "" })}
    ${(ap?.options ?? []).map(o => field(at(ap!, o.label), `<select class="field" id="agopt-${id}-${esc(o.id)}" data-agopt="${id}" data-opt="${esc(o.id)}">${o.choices.map(c =>
      `<option value="${esc(c.id)}" ${(cfg[o.id] ?? o.choices[0].id) === c.id ? "selected" : ""}>${at(ap!, c.label)}</option>`).join("")}</select>`, { id: `agopt-${id}-${esc(o.id)}` })).join("")}
    ${field(nc(t("ag.caps")), `<span class="pills">${caps}</span>`)}
    <div class="ss-foot"><span class="sp"></span>${removeBtn("ag", p.id)}</div>`;
}
// an integration in or out of the list: on for the sidebar, a board provider's token stays in the keychain
async function intSwitch(id: string, on: boolean) {
  const next = structuredClone(settings);
  if (id === "github") next.github.on = on;
  else if (id === "mail") next.mail = { ...next.mail, on };
  else next.integrations[id] = { ...next.integrations[id], on };
  try { settings = await invoke<Settings>("set_settings", { settings: next }); if (id === "mail") mailEdit.on = on; intMsg = ""; intOk = true; }
  catch (x) { intMsg = String(x); intOk = false; }
  render();
}
// one change to settings.agents, saved; the backend keeps the default on a switched-on agent
async function agSave(change: (a: Settings["agents"]) => void) {
  const agents = structuredClone(settings.agents); change(agents);
  try { settings = await invoke<Settings>("set_settings", { settings: { ...settings, agents } }); agMsg = ""; agOk = true; }
  catch (x) { agMsg = String(x); agOk = false; }
  render();
}
async function agCheck(quiet = false) {
  if (!quiet) { agSt = null; render(); }
  try { agSt = await agentsStatus(); } catch (e) { agMsg = String(e); agOk = false; }
  render();
}
async function ghCheck() {
  ghLogin = ""; ghErr = ""; render();
  try { ghLogin = await invoke<string>("github_status"); } catch (e) { ghErr = String(e); }
  render();
}

// language names stay in their own language, so they are findable whatever the app is set to
const LANG_OPTS = () => [["system", t("set.system")], ["en", "English"], ["nl", "Nederlands"], ["fr", "Français"], ["de", "Deutsch"]];
function render() {
  const title = t(TABS.find(x => x[0] === tab)![1]);
  root.innerHTML = `<nav class="snav"><div class="sn-g">${TABS.map(([id, name, g]) =>
      `<button class="sn-i${tab === id ? " on" : ""}" data-tab="${id}"${tab === id ? ' aria-current="page"' : ""}>${icon(g)}<span>${t(name)}</span></button>`).join("")}</div></nav>
    <section class="ppane"><div class="pcol">${tab === "general" ? general() : tab === "projects" ? projects() : tab === "agents" ? agents() : integrations()}</div></section>`;
  getCurrentWindow().setTitle(title).catch(() => {});
  document.title = title;
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
  const b = (e.target as HTMLElement).closest<HTMLElement>("[data-set]");
  if (menu && !(e.target as HTMLElement).closest(".menu-w")) { menu = ""; render(); }
  if (!b) return;
  const val = (id: string) => (document.getElementById(id) as HTMLInputElement).value.trim();
  if (b.dataset.set === "pick") { vs = (await pickVault()) ?? vs; msg = ""; render(); }
  if (b.dataset.set === "pickmap") { vs = await pickMapped(vs, b.dataset.k as MapKey, readMapping(root, vs)); render(); }
  if (b.dataset.set === "save") await save({ ...settings, vault: vs.vault, vaults: { ...settings.vaults, [vs.vault]: readMapping(root, vs) } }, t("set.saved"));
  if (b.dataset.set === "ghcheck") ghCheck();
  if (b.dataset.set === "agcheck") { agMsg = ""; agCheck(true); }
  // the lists: fold a row, the Add menu, add (folded open, to set it up) and remove
  const aid = b.dataset.id ?? "", kind = b.dataset.kind as "ag" | "int" | undefined, key = `${kind}:${aid}`;
  if (b.dataset.set === "fold") { if (!opened.delete(key)) opened.add(key); render(); }
  if (b.dataset.set === "menu") { menu = menu === kind ? "" : kind!; render(); }
  if (b.dataset.set === "add" || b.dataset.set === "remove") {
    const on = b.dataset.set === "add";
    menu = ""; if (on) opened.add(key); else opened.delete(key);
    if (kind === "ag") await agSave(a => { a.providers[aid] = { ...a.providers[aid], on }; }); else await intSwitch(aid, on);
  }
  if (b.dataset.set === "ghsave") {
    const next = { ...settings, github: { ...settings.github, owners: val("ghowners") } };
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
  const bp = provider(aid);
  if (bp && b.dataset.set === "bsave") {
    const cfg: Record<string, any> = { ...settings.integrations[bp.id], on: true };
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
  if (b.dataset.set === "pifind") { await findIcons(); return; }
  if (b.dataset.set === "piset") { await iconSet(b.dataset.id!, b.dataset.kindIcon as IconKind); return; }
  if (b.dataset.set === "repodel") { await setRepos(b.dataset.id!, (repos[b.dataset.id!] ?? []).filter(r => r !== b.dataset.repo)); return; }
  if (b.dataset.set === "clear") { const next = structuredClone(settings); delete next.projects[b.dataset.p!]; await save(next, t("set.restored")); }
});
// the language applies right away: saved, then this window and the main one redraw in it
root.addEventListener("change", async e => {
  const ti = e.target as HTMLInputElement;
  // one field for an emoji or a website: a dot makes it a website
  if (ti.dataset.picon !== undefined) { const v = ti.value.trim(); await iconSet(ti.dataset.picon, !v ? "reset" : isSite(v) ? "site" : "emoji", v); return; }
  if (ti.dataset.repoadd !== undefined) { const v = ti.value.trim(); if (v) await setRepos(ti.dataset.repoadd, [...(repos[ti.dataset.repoadd] ?? []), v]); return; }
  if (ti.dataset.plabel !== undefined) {
    const next = structuredClone(settings), n = ti.dataset.plabel, v = ti.value.trim();
    if (v) next.projects[n] = { ...next.projects[n], label: v }; else delete next.projects[n];
    await save(next, ""); return;
  }
  if (ti.dataset.pifile !== undefined) {
    const f = ti.files?.[0]; if (!f) return;
    const u = await iconFrom(f);
    if (u) await iconSet(ti.dataset.pifile, "img", u); else { iconMsg = t("img.unreadable"); iconOk = false; render(); }
    return;
  }
  const bm = (e.target as HTMLElement).closest<HTMLSelectElement>("[data-bmap]"), bp = bm && provider(bm.dataset.bp!);
  if (bm && bp) {
    // a vault project has at most one board: picking one replaces what it had, None only drops this provider's
    const vp = bm.dataset.bmap!, boards = { ...settings.boards }, [project, board] = bm.value.split("/");
    if (board) boards[vp] = { provider: bp.id, project, board }; else if (boards[vp]?.provider === bp.id) delete boards[vp]; else return;
    try { settings = await invoke<Settings>("set_settings", { settings: { ...settings, boards } }); pmsg[bp.id] = { text: t("set.saved"), ok: true }; }
    catch (x) { pmsg[bp.id] = { text: String(x), ok: false }; }
    render(); return;
  }
  const tg = e.target as HTMLInputElement;
  if (tg.dataset.agbin) { const id = tg.dataset.agbin, v = tg.value.trim(); await agSave(a => { a.providers[id] = { ...a.providers[id], bin: v }; }); agCheck(true); return; }
  if (tg.dataset.agopt) { const id = tg.dataset.agopt, o = tg.dataset.opt!, v = tg.value; await agSave(a => { a.providers[id] = { ...a.providers[id], [o]: v }; }); return; }
  if (tg.id === "agdefault") { const v = tg.value; await agSave(a => { a.default = v; }); return; }
  if ((e.target as HTMLElement).matches("[data-map]")) { vs = await checkMapping(vs.vault, readMapping(root, vs)); render(); return; }
  const fav = (e.target as HTMLElement).closest<HTMLInputElement>("#favon");
  if (fav) { await save({ ...settings, favicons: { last: "", tried: {}, ...settings.favicons, on: fav.checked } }, ""); return; }
  const sel = (e.target as HTMLElement).closest<HTMLSelectElement>("#language"); if (!sel) return;
  await save({ ...settings, language: sel.value }, "");
  await initI18n(); render();
});
window.addEventListener("keydown", e => {
  if (e.key === "Escape" || (e.metaKey && e.key === "w")) window.close();
  // Cmd-1 to 4 jump to a page
  const n = e.metaKey && !e.altKey && !e.shiftKey ? Number(e.key) : 0;
  if (n >= 1 && n <= TABS.length) { e.preventDefault(); go(TABS[n - 1][0]); }
});
render();
ghCheck();
agCheck();
