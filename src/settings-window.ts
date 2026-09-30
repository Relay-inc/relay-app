import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./settings.css";

// The settings window, laid out like Mail's: a toolbar of icon tabs, the window title follows the tab.
// Algemeen holds the vault folder, Projecten the projects the user customised, Integraties the external
// services (Productive, GitHub) as a list on the left with the details on the right, like Mail's Accounts.
// Saving emits "settings-changed" from the backend, the main window follows it.
type Settings = { vault: string; projects: Record<string, { icon?: string; img?: string; label?: string }>; overrides: Record<string, string | null>;
  productive: { org: string; user: string }; github: { on: boolean; owners: string } };
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const root = document.getElementById("set")!;
let settings: Settings = await invoke<Settings>("get_settings");
let msg = "", ok = false;
// Productive: the token sits in the macOS keychain, the backend only says whether there is one
let hasToken = await invoke<boolean>("productive_status"), pvMsg = "", pvOk = false;
// GitHub: no token of our own, the app uses gh's login. The status is the account gh is signed in with
let ghLogin = "", ghErr = "", ghMsg = "", ghOk = false;
let acct = localStorage.getItem("prefsAcct") === "github" ? "github" : "productive";

const G: Record<string, string> = {
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>',
  folder: '<path d="M3.5 7V6a1.5 1.5 0 0 1 1.5-1.5h4.5l2 2H19A1.5 1.5 0 0 1 20.5 8v10a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18V7Z"/>',
  plug: '<path d="M9 3.5v4M15 3.5v4M6.5 7.5h11v3a5.5 5.5 0 0 1-11 0v-3ZM12 16v4.5"/>',
  // Productive's favicon (productive.io), as vector: its own colours, not the glyph stroke
  // GitHub's mark (octicon mark-github), in the label colour
  gh: '<path transform="translate(4 4)" fill="currentColor" stroke="none" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>',
  board: '<g transform="scale(1.5)"><defs><linearGradient id="pvg" x1="0" y1="0" x2="16" y2="16" gradientUnits="userSpaceOnUse"><stop stop-color="#AB40FF"/><stop offset="1" stop-color="#5D2BFF"/></linearGradient></defs><rect width="16" height="16" rx="3.6" fill="url(#pvg)" stroke="none"/><g transform="translate(2.5 1.6) scale(.357)" fill="#fff" stroke="none"><path d="M6.036 28.89L.17 18.977a1.217 1.217 0 01.426-1.667l4.633-2.74a1.217 1.217 0 011.666.426l3.3 5.579 3.424-5.89c4.28-7.018 8.712.738 6.693 4.034l-5.89 10.139a2.836 2.836 0 01-2.443 1.412l-3.492.015a2.838 2.838 0 01-2.451-1.393z"/><path d="M30.847 21.445a4.4 4.4 0 11-8.802.001 4.4 4.4 0 018.802 0zm-18.259 3.176c.966 1.64 3.34 1.632 4.297-.014l3.429-5.9c1.787-2.917 3.807-4.476 6.333-4.82.612-.083 1.211-.224 1.374-1.145l.938-5.259a1.234 1.234 0 00-1.207-1.485c-4.603 0-9.956 1.825-14.131 8.672l-3.426 5.892 2.393 4.059z"/></g></g>',
};
const icon = (n: string) => `<svg viewBox="0 0 24 24">${G[n]}</svg>`;
const TABS = [["general", "Algemeen", "gear"], ["projects", "Projecten", "folder"], ["integrations", "Integraties", "plug"]] as const;
type Tab = typeof TABS[number][0];
let tab: Tab = (TABS.find(t => t[0] === localStorage.getItem("prefsTab"))?.[0]) ?? "general";

function general() {
  return `<div class="form">
      <span class="fl">Vault-map:</span>
      <div class="setrow"><input class="field" id="vaultpath" value="${esc(settings.vault)}" placeholder="Kies de map met je vault" spellcheck="false"><button class="btn" data-set="pick">Kies map…</button></div>
      <span></span><div class="hint">De map met je Obsidian-vault. Gesprekken starten daarin, en de zijbalk leest er work-state en reminders uit.</div>
    </div>
    <div class="setrow end">${msg ? `<span class="${ok ? "okmsg" : "errmsg"}">${esc(msg)}</span>` : ""}<button class="btn primary" data-set="save">Opslaan</button></div>`;
}
function projects() {
  const custom = Object.entries(settings.projects).filter(([, c]) => c.icon || c.img || c.label);
  return `<div class="hint">Icoon en naam zet je per project in het hoofdvenster: klik bovenaan een gesprek op de projectnaam met het pijltje.</div>
    ${custom.length ? `<ul class="todo">${custom.map(([n, c]) => `<li class="setli"><span>${c.img && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(c.img) ? `<img class="pimg" src="${c.img}" alt="">` : esc(c.icon || "")} ${esc(c.label || n)} <span class="count">${c.label ? esc(n) : ""}</span></span><button class="btn" data-set="clear" data-p="${esc(n)}">Herstellen</button></li>`).join("")}</ul>`
      : '<div class="hint">Nog geen aangepaste projecten.</div>'}
    ${msg ? `<div class="setrow end"><span class="${ok ? "okmsg" : "errmsg"}">${esc(msg)}</span></div>` : ""}`;
}
function integrations() {
  const ready = hasToken && !!settings.productive.org, gh = !!ghLogin && settings.github.on;
  const li = (id: string, g: string, name: string, on: boolean) =>
    `<li class="${acct === id ? "sel" : ""}" data-acct="${id}"><span class="atile ${id}">${icon(g)}</span><span><b>${name}</b><span class="asub">${on ? "Ingesteld" : "Niet ingesteld"}</span></span></li>`;
  return `<div class="accts">
    <ul class="alist">${li("productive", "board", "Productive", ready)}${li("github", "gh", "GitHub", gh)}</ul>
    ${acct === "github" ? github() : productive(ready)}</div>`;
}
function github() {
  return `<div class="apane">
      <div class="form">
        <span class="fl">Status:</span><span class="status"><span class="sdot ${ghLogin ? "on" : ""}"></span>${ghLogin ? `Verbonden als ${esc(ghLogin)} via gh` : esc(ghErr || "Bezig met nakijken…")}</span>
        <span class="fl">Zijbalk:</span><label class="chk"><input type="checkbox" id="ghon" ${settings.github.on ? "checked" : ""}> Pull requests tonen</label>
        <label class="fl" for="ghowners">Owners:</label><input class="field" id="ghowners" value="${esc(settings.github.owners)}" spellcheck="false" placeholder="Leeg is overal, bv. weareantenna">
        <span></span><div class="hint">Toont je open PR's en die waar je review gevraagd wordt, per project gekoppeld via de repos op de projectkaart. Enkel lezen, een klik opent de PR op GitHub. De app gebruikt de login van de GitHub CLI, er staat geen token in de app. Niet ingelogd: voer <code>gh auth login</code> uit in de terminal.</div>
      </div>
      <div class="setrow end">${ghMsg ? `<span class="${ghOk ? "okmsg" : "errmsg"}">${esc(ghMsg)}</span>` : ""}<button class="btn" data-set="ghcheck">Opnieuw nakijken</button><button class="btn primary" data-set="ghsave">Opslaan</button></div>
    </div>`;
}
function productive(ready: boolean) {
  return `<div class="apane">
      <div class="form">
        <span class="fl">Status:</span><span class="status"><span class="sdot ${ready ? "on" : ""}"></span>${ready ? "Ingesteld" : "Niet ingesteld"}</span>
        <label class="fl" for="pvtoken">API-token:</label><input class="field" id="pvtoken" type="password" autocomplete="off" spellcheck="false" placeholder="${hasToken ? "Opgeslagen in de sleutelhanger" : "Plak je token"}">
        <label class="fl" for="pvorg">Organisatie-id:</label><input class="field" id="pvorg" inputmode="numeric" value="${esc(settings.productive.org)}" spellcheck="false">
        <label class="fl" for="pvuser">Gebruikers-id:</label><input class="field" id="pvuser" inputmode="numeric" value="${esc(settings.productive.user)}" spellcheck="false" placeholder="Toont enkel jouw projecten">
        <span></span><div class="hint">Voor het bord in de zijbalk, dat pas verschijnt als dit ingesteld is. Het token staat in de macOS-sleutelhanger, niet in een bestand. In Productive vind je het onder Settings › API integrations.</div>
      </div>
      <div class="setrow"><button class="btn" data-set="pvimport">Overnemen uit Claude Code</button>${hasToken ? '<button class="btn" data-set="pvclear">Token wissen</button>' : ""}</div>
      <div class="setrow end">${pvMsg ? `<span class="${pvOk ? "okmsg" : "errmsg"}">${esc(pvMsg)}</span>` : ""}<button class="btn primary" data-set="pvsave">Opslaan en testen</button></div>
    </div>`;
}
async function ghCheck() {
  ghLogin = ""; ghErr = ""; render();
  try { ghLogin = await invoke<string>("github_status"); } catch (e) { ghErr = String(e); }
  render();
}

function render() {
  const cur = TABS.find(t => t[0] === tab)!;
  root.innerHTML = `<nav class="ptabs">${TABS.map(([id, name, g]) => `<button class="ptab${id === tab ? " on" : ""}" data-tab="${id}">${icon(g)}<span>${name}</span></button>`).join("")}</nav>
    <section class="ppane">${tab === "general" ? general() : tab === "projects" ? projects() : integrations()}</section>`;
  getCurrentWindow().setTitle(cur[1]).catch(() => {});
}
const go = (t: Tab) => { tab = t; localStorage.setItem("prefsTab", t); msg = ""; render(); };
// saves the ids, then one call to Productive to show that token and org work together
async function pvSave(org: string, user: string, token?: string) {
  try {
    if (token) await invoke("productive_token", { token });
    hasToken = await invoke<boolean>("productive_status");
    settings = await invoke<Settings>("set_settings", { settings: { ...settings, productive: { org, user } } });
    const who = user ? await invoke<any>("productive", { method: "GET", path: `/people/${user}`, body: null })
      : await invoke<any>("productive", { method: "GET", path: "/projects?page[size]=1", body: null });
    const a = who?.data?.attributes || {};
    pvMsg = user ? `Verbonden als ${[a.first_name, a.last_name].filter(Boolean).join(" ")}.` : "Verbonden."; pvOk = true;
  } catch (e) { pvMsg = String(e); pvOk = false; }
  render();
}
async function save(next: Settings, done: string) {
  try { settings = await invoke<Settings>("set_settings", { settings: next }); msg = done; ok = true; }
  catch (e) { msg = String(e); ok = false; }
  render();
}
root.addEventListener("click", async e => {
  const t = (e.target as HTMLElement).closest<HTMLElement>("[data-tab]");
  if (t) { go(t.dataset.tab as Tab); return; }
  const a = (e.target as HTMLElement).closest<HTMLElement>("[data-acct]");
  if (a) { acct = a.dataset.acct!; localStorage.setItem("prefsAcct", acct); render(); return; }
  const b = (e.target as HTMLElement).closest<HTMLElement>("[data-set]"); if (!b) return;
  const val = (id: string) => (document.getElementById(id) as HTMLInputElement).value.trim();
  if (b.dataset.set === "pick") { const f = await invoke<string | null>("pick_folder"); if (f) (document.getElementById("vaultpath") as HTMLInputElement).value = f; }
  if (b.dataset.set === "save") await save({ ...settings, vault: val("vaultpath") }, "Opgeslagen.");
  if (b.dataset.set === "ghcheck") ghCheck();
  if (b.dataset.set === "ghsave") {
    const next = { ...settings, github: { on: (document.getElementById("ghon") as HTMLInputElement).checked, owners: val("ghowners") } };
    try { settings = await invoke<Settings>("set_settings", { settings: next }); ghMsg = "Opgeslagen."; ghOk = true; }
    catch (x) { ghMsg = String(x); ghOk = false; }
    render();
  }
  if (b.dataset.set === "pvsave") { pvMsg = "Bezig…"; pvOk = true; render(); await pvSave(val("pvorg"), val("pvuser"), val("pvtoken")); }
  if (b.dataset.set === "pvimport") {
    try { const r = await invoke<{ org: string; user: string }>("productive_import"); await pvSave(r.org, r.user); }
    catch (e) { pvMsg = String(e); pvOk = false; render(); }
  }
  if (b.dataset.set === "pvclear") { await invoke("productive_token", { token: "" }); hasToken = false; pvMsg = "Token gewist."; pvOk = true; render(); }
  if (b.dataset.set === "clear") { const next = structuredClone(settings); delete next.projects[b.dataset.p!]; await save(next, "Hersteld."); }
});
window.addEventListener("keydown", e => {
  if (e.key === "Escape" || (e.metaKey && e.key === "w")) window.close();
  // Cmd-1, 2, 3 jump to a tab
  const n = e.metaKey && !e.altKey && !e.shiftKey ? Number(e.key) : 0;
  if (n >= 1 && n <= TABS.length) { e.preventDefault(); go(TABS[n - 1][0]); }
});
render();
ghCheck();
