import { invoke } from "@tauri-apps/api/core";
import { t } from "./i18n";
import type { Key } from "./locales/en";

// The vault and its mapping: which file or folder the app reads for each piece, relative to the vault.
// Shared by the first-launch screen and the settings window. The backend detects, checks and saves.
export type VaultMap = Record<MapKey, string>;
export type VaultStatus = { vault: string; map: VaultMap; found: Record<MapKey, boolean>; ok: boolean };
export type MapKey = "workState" | "reminders" | "reminderScript" | "notes";
// key, is a folder, required: the same list as KEYS in src-tauri/src/vault.rs
const KEYS: [MapKey, boolean, boolean][] = [["workState", false, true], ["reminders", false, false], ["reminderScript", false, false], ["notes", true, false]];
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** The mapping rows: label and hint, an editable path with a picker, and found / missing. */
export function renderMapping(st: VaultStatus): string {
  return `<div class="vmap">${KEYS.map(([k, , req]) => {
    const found = st.found[k];
    return `<div class="vrow">
      <div class="vlabel">${t(`vault.k.${k}` as Key)}${req ? "" : ` <span class="count">${t("vault.optional")}</span>`}
        <div class="meta">${t(`vault.h.${k}` as Key)}</div></div>
      <div class="setrow"><input class="field" data-map="${k}" value="${esc(st.map[k])}" spellcheck="false">
        <button class="btn" data-set="pickmap" data-k="${k}">${t("vault.pickPath")}</button>
        <span class="vfound ${found ? "okmsg" : req ? "errmsg" : "meta"}">${found ? t("vault.found") : t("vault.missing")}</span></div>
    </div>`;
  }).join("")}</div>`;
}

/** The mapping as edited in the inputs under `root`. */
export function readMapping(root: ParentNode, st: VaultStatus): VaultMap {
  const m = { ...st.map };
  root.querySelectorAll<HTMLInputElement>("[data-map]").forEach(i => { m[i.dataset.map as MapKey] = i.value.trim(); });
  return m;
}

/** Pick a folder and detect its mapping (stored overrides on top). Null when cancelled. */
export async function pickVault(): Promise<VaultStatus | null> {
  const f = await invoke<string | null>("pick_folder");
  return f ? invoke<VaultStatus>("detect_vault", { path: f }) : null;
}

/** Pick one mapped path, stored relative when it lies in the vault. Returns the new status. */
export async function pickMapped(st: VaultStatus, key: MapKey, map: VaultMap): Promise<VaultStatus> {
  const folder = KEYS.find(([k]) => k === key)![1];
  const p = await invoke<string | null>("pick_path", { folder, start: st.vault });
  if (!p) return st;
  const rel = p.startsWith(st.vault + "/") ? p.slice(st.vault.length + 1) : p;
  return checkMapping(st.vault, { ...map, [key]: rel });
}
export const checkMapping = (vault: string, map: VaultMap) => invoke<VaultStatus>("check_vault", { path: vault, map });

/** First launch, or a vault that is gone: a welcome screen over the main window until a vault is saved. */
export function onboard(start: VaultStatus): Promise<void> {
  const el = document.createElement("div");
  el.className = "onboard prefs";
  document.body.append(el);
  // what was configured before (a folder that no longer holds a vault) stays visible, to fix or replace
  let st: VaultStatus | null = start.vault ? start : null, msg = "";
  const render = () => {
    el.innerHTML = `<main class="set">
      <h2>${t("vault.welcome")}</h2>
      <div class="meta">${t("vault.intro")}</div>
      <div class="setrow"><input class="field" readonly value="${esc(st?.vault ?? "")}" placeholder="${t("vault.none")}">
        <button class="btn${st ? "" : " primary"}" data-set="pick">${t("vault.choose")}</button></div>
      ${st ? `<h2>${t("vault.map")}</h2><div class="meta">${t("vault.mapHelp")}</div>${renderMapping(st)}` : ""}
      ${st && !st.ok ? `<div class="errmsg">${t("vault.invalid")}</div>` : ""}
      <div class="setrow end">${msg ? `<span class="errmsg">${esc(msg)}</span>` : ""}
        <button class="btn primary" data-set="use" ${st?.ok ? "" : "disabled"}>${t("vault.use")}</button></div>
    </main>`;
  };
  render();
  return new Promise(done => {
    el.addEventListener("click", async e => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-set]"); if (!b) return;
      msg = "";
      if (b.dataset.set === "pick") st = (await pickVault()) ?? st;
      if (b.dataset.set === "pickmap" && st) st = await pickMapped(st, b.dataset.k as MapKey, readMapping(el, st));
      if (b.dataset.set === "use" && st) {
        try {
          const s = await invoke<any>("get_settings");
          await invoke("set_settings", { settings: { ...s, vault: st.vault, vaults: { ...s.vaults, [st.vault]: readMapping(el, st) } } });
          el.remove(); done(); return;
        } catch (err) { msg = String(err); }
      }
      render();
    });
    el.addEventListener("change", async e => {
      if (!st || !(e.target as HTMLElement).matches("[data-map]")) return;
      st = await checkMapping(st.vault, readMapping(el, st)); render();
    });
  });
}
