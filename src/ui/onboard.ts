import { LitElement, html, nothing } from "lit";
import { live } from "lit/directives/live.js";
import { invoke } from "@tauri-apps/api/core";
import { t, th } from "../i18n";
import { styles } from "../lib/store";
import { KEYS, pickVault, pickMapped, checkMapping, type VaultMap, type VaultStatus } from "../vault-setup";
import mark from "../relay-mark.svg";
import css from "./onboard.css?inline";

/** First launch, or a vault that is gone: a welcome screen over the main window until a vault is saved. */
export class RelayOnboard extends LitElement {
  static styles = styles(css);
  static properties = { st: { state: true }, map: { state: true }, msg: { state: true } };
  declare st: VaultStatus | null;
  declare map: VaultMap | null; // the paths as typed, checked on change
  declare msg: string;
  done: () => void = () => {};

  // what was configured before (a folder that no longer holds a vault) stays visible, to fix or replace
  constructor(start?: VaultStatus) { super(); this.set(start?.vault ? start : null); this.msg = ""; }
  private set(st: VaultStatus | null) { this.st = st; this.map = st ? { ...st.map } : null; }
  private trimmed = (): VaultMap => Object.fromEntries(Object.entries(this.map!).map(([k, v]) => [k, v.trim()])) as VaultMap;

  private async pick() { this.msg = ""; const s = await pickVault(); if (s) this.set(s); }
  private async pickMap(k: typeof KEYS[number][0]) { this.msg = ""; this.set(await pickMapped(this.st!, k, this.trimmed())); }
  private async check() { this.set(await checkMapping(this.st!.vault, this.trimmed())); }
  private async use() {
    this.msg = "";
    try {
      const s = await invoke<any>("get_settings");
      await invoke("set_settings", { settings: { ...s, vault: this.st!.vault, vaults: { ...s.vaults, [this.st!.vault]: this.trimmed() } } });
      this.remove(); this.done();
    } catch (err) { this.msg = String(err); }
  }

  private mapping(st: VaultStatus) {
    return html`<div class="vmap">${KEYS.map(([k, , req]) => {
      const found = st.found[k];
      return html`<div class="vrow">
        <div class="vlabel">${th(`vault.k.${k}`)}${req ? nothing : html` <span class="count">${t("vault.optional")}</span>`}
          <div class="meta">${th(`vault.h.${k}`)}</div></div>
        <div class="setrow"><input class="field" .value=${live(this.map![k])} @input=${(e: Event) => { this.map![k] = (e.target as HTMLInputElement).value; }} @change=${() => this.check()} spellcheck="false">
          <button class="btn" @click=${() => this.pickMap(k)}>${t("vault.pickPath")}</button>
          <span class="vfound ${found ? "okmsg" : req ? "errmsg" : "meta"}">${found ? t("vault.found") : t("vault.missing")}</span></div>
      </div>`;
    })}</div>`;
  }

  render() {
    const st = this.st;
    return html`<main class="set">
      <img class="logo" src=${mark} alt="">
      <h2>${t("vault.welcome")}</h2>
      <div class="meta">${th("vault.intro")}</div>
      <div class="setrow"><input class="field" readonly .value=${st?.vault ?? ""} placeholder=${t("vault.none")}>
        <button class="btn${st ? "" : " primary"}" @click=${() => this.pick()}>${t("vault.choose")}</button></div>
      ${st ? html`<h2>${t("vault.map")}</h2><div class="meta">${th("vault.mapHelp")}</div>${this.mapping(st)}` : nothing}
      ${st && !st.ok ? html`<div class="errmsg">${th("vault.invalid")}</div>` : nothing}
      <div class="setrow end">${this.msg ? html`<span class="errmsg">${this.msg}</span>` : nothing}
        <button class="btn primary" ?disabled=${!st?.ok} @click=${() => this.use()}>${t("vault.use")}</button></div>
    </main>`;
  }
}
customElements.define("relay-onboard", RelayOnboard);

export function onboard(start: VaultStatus): Promise<void> {
  const el = new RelayOnboard(start);
  document.body.append(el);
  return new Promise(done => { el.done = done; });
}
