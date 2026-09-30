import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./settings.css";
import { initI18n, t } from "./i18n";
import type { Key } from "./locales/en";
import { PROVIDERS, provider, ctxOf, type BoardProvider, type BoardRef } from "./providers";
import { renderMapping, readMapping, pickVault, pickMapped, checkMapping, type VaultStatus, type VaultMap, type MapKey } from "./vault-setup";

// The settings window, laid out like Mail's: a toolbar of icon tabs, the window title follows the tab.
// General holds the vault folder with its mapping and the language, Projects the projects the user customised,
// Integrations the external services (the board providers from src/providers/, GitHub) as a list on the left with the details on the right,
// like Mail's Accounts. Saving emits "settings-changed" from the backend, the main window follows it.
type Settings = { vault: string; vaults?: Record<string, VaultMap>; projects: Record<string, { icon?: string; img?: string; label?: string }>; overrides: Record<string, string | null>;
  integrations: Record<string, Record<string, any>>; boards: Record<string, BoardRef>; github: { on: boolean; owners: string }; language?: string };
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
let acct = localStorage.getItem("prefsAcct") || "";
if (acct !== "github" && !provider(acct)) acct = PROVIDERS[0].id;

const G: Record<string, string> = {
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>',
  folder: '<path d="M3.5 7V6a1.5 1.5 0 0 1 1.5-1.5h4.5l2 2H19A1.5 1.5 0 0 1 20.5 8v10a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18V7Z"/>',
  plug: '<path d="M9 3.5v4M15 3.5v4M6.5 7.5h11v3a5.5 5.5 0 0 1-11 0v-3ZM12 16v4.5"/>',
  // GitHub's mark (octicon mark-github), in the label colour
  gh: '<path transform="translate(4 4)" fill="currentColor" stroke="none" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>',
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
    </div>`;
}
function projects() {
  const custom = Object.entries(settings.projects).filter(([, c]) => c.icon || c.img || c.label);
  return `<div class="hint">${t("set.customHelp")}</div>
    ${custom.length ? `<ul class="todo">${custom.map(([n, c]) => `<li class="setli"><span>${c.img && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(c.img) ? `<img class="pimg" src="${c.img}" alt="">` : esc(c.icon || "")} ${esc(c.label || n)} <span class="count">${c.label ? esc(n) : ""}</span></span><button class="btn" data-set="clear" data-p="${esc(n)}">${t("set.reset")}</button></li>`).join("")}</ul>`
      : `<div class="hint">${t("set.none")}</div>`}
    ${msg ? `<div class="setrow end"><span class="${ok ? "okmsg" : "errmsg"}">${esc(msg)}</span></div>` : ""}`;
}
// set up: a token and every field that is not optional
const setUp = (p: BoardProvider) => tokens[p.id] && p.settings.fields.every(f => f.optional || settings.integrations[p.id]?.[f.key]);
function integrations() {
  const gh = !!ghLogin && settings.github.on;
  const li = (id: string, tile: string, name: string, on: boolean) =>
    `<li class="${acct === id ? "sel" : ""}" data-acct="${id}"><span class="atile ${id}">${tile}</span><span><b>${name}</b><span class="asub">${on ? t("int.set") : t("int.notSet")}</span></span></li>`;
  const p = provider(acct);
  return `<div class="accts">
    <ul class="alist">${PROVIDERS.map(x => li(x.id, pIcon(x), esc(x.name), setUp(x))).join("")}${li("github", icon("gh"), "GitHub", gh)}</ul>
    ${p ? boardPane(p) : github()}</div>`;
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
// one board provider: switched on for the sidebar, the token, the fields of its config
function boardPane(p: BoardProvider) {
  const cfg = settings.integrations[p.id] || {}, ready = setUp(p), has = tokens[p.id], m = pmsg[p.id], id = esc(p.id);
  return `<div class="apane">
      <div class="form">
        <span class="fl">${t("int.status")}</span><span class="status"><span class="sdot ${ready ? "on" : ""}"></span>${ready ? t("int.set") : t("int.notSet")}</span>
        <span class="fl">${t("int.sidebar")}</span><label class="chk"><input type="checkbox" id="on-${id}" ${cfg.on !== false ? "checked" : ""}> ${t("int.showBoard")}</label>
        <label class="fl" for="tok-${id}">${t(p.settings.tokenLabel)}</label><input class="field" id="tok-${id}" type="password" autocomplete="off" spellcheck="false" placeholder="${has ? t("int.tokenStored") : t("int.tokenPaste")}">
        ${p.settings.fields.map(f => `<label class="fl" for="f-${id}-${esc(f.key)}">${t(f.label)}</label><input class="field" id="f-${id}-${esc(f.key)}"${f.numeric ? ' inputmode="numeric"' : ""} value="${esc(cfg[f.key] ?? "")}" spellcheck="false"${f.placeholder ? ` placeholder="${t(f.placeholder)}"` : ""}>`).join("\n        ")}
        <span></span><div class="hint">${t(p.settings.help)}</div>
      </div>
      <div class="setrow">${p.settings.import ? `<button class="btn" data-set="bimport">${t(p.settings.import.label)}</button>` : ""}${has ? `<button class="btn" data-set="bclear">${t("int.clear")}</button>` : ""}</div>
      <div class="setrow end">${m ? `<span class="${m.ok ? "okmsg" : "errmsg"}">${esc(m.text)}</span>` : ""}<button class="btn primary" data-set="bsave">${t("int.save")}</button></div>
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
async function boardSave(p: BoardProvider, cfg: Record<string, any>, token?: string) {
  try {
    if (token) await invoke("integration_token", { provider: p.id, token });
    tokens[p.id] = await invoke<boolean>("integration_has_token", { provider: p.id });
    settings = await invoke<Settings>("set_settings", { settings: { ...settings, integrations: { ...settings.integrations, [p.id]: cfg } } });
    pmsg[p.id] = { text: await p.settings.test(ctxOf(p, settings.integrations)), ok: true };
  } catch (e) { pmsg[p.id] = { text: String(e), ok: false }; }
  render();
}
async function save(next: Settings, done: string) {
  try { settings = await invoke<Settings>("set_settings", { settings: next }); vs = await invoke<VaultStatus>("vault_status"); msg = done; ok = true; }
  catch (e) { msg = String(e); ok = false; }
  render();
}
root.addEventListener("click", async e => {
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
  const bp = provider(acct);
  if (bp && b.dataset.set === "bsave") {
    const cfg: Record<string, any> = { ...settings.integrations[bp.id], on: (document.getElementById(`on-${bp.id}`) as HTMLInputElement).checked };
    for (const f of bp.settings.fields) cfg[f.key] = val(`f-${bp.id}-${f.key}`);
    pmsg[bp.id] = { text: t("int.busy"), ok: true }; render();
    await boardSave(bp, cfg, val(`tok-${bp.id}`));
  }
  if (bp?.settings.import && b.dataset.set === "bimport") {
    try { const r = await bp.settings.import.run(); await boardSave(bp, { ...settings.integrations[bp.id], ...r }); }
    catch (e) { pmsg[bp.id] = { text: String(e), ok: false }; render(); }
  }
  if (bp && b.dataset.set === "bclear") {
    await invoke("integration_token", { provider: bp.id, token: "" }); tokens[bp.id] = false; pmsg[bp.id] = { text: t("int.cleared"), ok: true }; render();
  }
  if (b.dataset.set === "clear") { const next = structuredClone(settings); delete next.projects[b.dataset.p!]; await save(next, t("set.restored")); }
});
// the language applies right away: saved, then this window and the main one redraw in it
root.addEventListener("change", async e => {
  if ((e.target as HTMLElement).matches("[data-map]")) { vs = await checkMapping(vs.vault, readMapping(root, vs)); render(); return; }
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
