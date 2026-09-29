import { invoke } from "@tauri-apps/api/core";

// The settings window: vault folder and the projects Laurent customised. Saving emits
// "settings-changed" from the backend, the main window follows it.
type Settings = { vault: string; projects: Record<string, { icon?: string; label?: string }>; overrides: Record<string, string | null> };
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const root = document.getElementById("set")!;
let settings: Settings = await invoke<Settings>("get_settings");
let msg = "", ok = false;

function render() {
  const custom = Object.entries(settings.projects).filter(([, c]) => c.icon || c.label);
  root.innerHTML = `
    <h2>Vault</h2>
    <div class="meta">De map met je Obsidian-vault. Gesprekken starten daarin, en de zijbalk leest er work-state en reminders uit.</div>
    <div class="setrow"><input class="field" id="vaultpath" value="${esc(settings.vault)}" spellcheck="false"><button class="btn" data-set="pick">Kies map…</button></div>
    <div class="setrow end">${msg ? `<span class="${ok ? "okmsg" : "errmsg"}">${esc(msg)}</span>` : ""}<button class="btn primary" data-set="save">Opslaan</button></div>
    <h2>Aangepaste projecten</h2>
    <div class="meta">Icoon en naam zet je per project in het hoofdvenster: klik bovenaan een gesprek op de projectnaam met het pijltje.</div>
    ${custom.length ? `<ul class="todo">${custom.map(([n, c]) => `<li class="setli"><span>${esc(c.icon || "")} ${esc(c.label || n)} <span class="count">${c.label ? esc(n) : ""}</span></span><button class="btn" data-set="clear" data-p="${esc(n)}">Herstellen</button></li>`).join("")}</ul>`
      : '<div class="meta">Nog geen.</div>'}`;
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
  if (b.dataset.set === "save") await save({ ...settings, vault: input.value.trim() }, "Opgeslagen.");
  if (b.dataset.set === "clear") { const next = structuredClone(settings); delete next.projects[b.dataset.p!]; await save(next, "Hersteld."); }
});
window.addEventListener("keydown", e => { if (e.key === "Escape" || (e.metaKey && e.key === "w")) window.close(); });
render();
