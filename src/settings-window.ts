import { invoke } from "@tauri-apps/api/core";
import { initI18n, t } from "./i18n";

// The settings window: vault folder and the projects Laurent customised. Saving emits
// "settings-changed" from the backend, the main window follows it.
type Settings = { vault: string; projects: Record<string, { icon?: string; label?: string }>; overrides: Record<string, string | null>; language?: string };
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const root = document.getElementById("set")!;
let settings: Settings = await invoke<Settings>("get_settings");
let msg = "", ok = false;
await initI18n();

// language names stay in their own language, so they are findable whatever the app is set to
const LANG_OPTS = () => [["system", t("set.system")], ["en", "English"], ["nl", "Nederlands"], ["fr", "Français"], ["de", "Deutsch"]];
function render() {
  const custom = Object.entries(settings.projects).filter(([, c]) => c.icon || c.label);
  root.innerHTML = `
    <h2>Vault</h2>
    <div class="meta">${t("set.vaultHelp")}</div>
    <div class="setrow"><input class="field" id="vaultpath" value="${esc(settings.vault)}" spellcheck="false"><button class="btn" data-set="pick">${t("set.pick")}</button></div>
    <div class="setrow end">${msg ? `<span class="${ok ? "okmsg" : "errmsg"}">${esc(msg)}</span>` : ""}<button class="btn primary" data-set="save">${t("set.save")}</button></div>
    <h2>${t("set.custom")}</h2>
    <div class="meta">${t("set.customHelp")}</div>
    ${custom.length ? `<ul class="todo">${custom.map(([n, c]) => `<li class="setli"><span>${esc(c.icon || "")} ${esc(c.label || n)} <span class="count">${c.label ? esc(n) : ""}</span></span><button class="btn" data-set="clear" data-p="${esc(n)}">${t("set.reset")}</button></li>`).join("")}</ul>`
      : `<div class="meta">${t("set.none")}</div>`}
    <h2>${t("set.language")}</h2>
    <div class="meta">${t("set.languageHelp")}</div>
    <div class="setrow"><select class="field" id="language">${LANG_OPTS().map(([v, name]) =>
      `<option value="${v}" ${(settings.language || "system") === v ? "selected" : ""}>${esc(name)}</option>`).join("")}</select></div>`;
  document.title = t("set.title");
}
async function save(next: Settings, done: string) {
  try { settings = await invoke<Settings>("set_settings", { settings: next }); msg = done; ok = true; }
  catch (e) { msg = String(e); ok = false; }
  render();
}
root.addEventListener("click", async e => {
  const b = (e.target as HTMLElement).closest<HTMLElement>("[data-set]"); if (!b) return;
  const input = document.getElementById("vaultpath") as HTMLInputElement;
  if (b.dataset.set === "pick") { const f = await invoke<string | null>("pick_folder"); if (f) input.value = f; }
  if (b.dataset.set === "save") await save({ ...settings, vault: input.value.trim() }, t("set.saved"));
  if (b.dataset.set === "clear") { const next = structuredClone(settings); delete next.projects[b.dataset.p!]; await save(next, t("set.restored")); }
});
// the language applies right away: saved, then this window and the main one redraw in it
root.addEventListener("change", async e => {
  const sel = (e.target as HTMLElement).closest<HTMLSelectElement>("#language"); if (!sel) return;
  await save({ ...settings, language: sel.value }, "");
  await initI18n(); render();
});
window.addEventListener("keydown", e => { if (e.key === "Escape" || (e.metaKey && e.key === "w")) window.close(); });
render();
