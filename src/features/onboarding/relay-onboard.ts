import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { invoke } from "@tauri-apps/api/core";
import { t, th } from "../../core/i18n";
import { emit } from "../../core/dom";
import { tw } from "../../core/styles";
import { KEYS, pickVault, pickMapped, checkMapping, type VaultMap, type VaultStatus } from "../../domain/vault-setup";
import mark from "../../relay-mark.svg";

declare global { interface HTMLElementEventMap { saved: CustomEvent<void> } }

/** First launch, or a vault that is gone: a welcome screen over the main window until a vault is saved (then it removes itself and emits `saved`). */
@customElement("relay-onboard")
export class RelayOnboard extends LitElement {
  static styles = [tw, css`:host{position:fixed;inset:0;z-index:50;overflow:auto;background:var(--inspector);padding:28px 32px;display:block}`];
  // what was configured before (a folder that no longer holds a vault) stays visible, to fix or replace
  @property({ attribute: false }) start?: VaultStatus;
  @state() private st: VaultStatus | null = null;
  @state() private map: VaultMap | null = null; // the paths as typed, checked on change
  @state() private msg = "";

  connectedCallback() { super.connectedCallback(); this.set(this.start?.vault ? this.start : null); }
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
      this.remove(); emit(this, "saved");
    } catch (err) { this.msg = String(err); }
  }

  private mapping(st: VaultStatus) {
    return html`<div class="grid gap-2.5">${KEYS.map(([k, , req]) => {
      const found = st.found[k];
      return html`<div class="grid gap-1">
        <div class="font-medium">${th(`vault.k.${k}`)}${req ? nothing : html` <span class="text-secondary tabular-nums">${t("vault.optional")}</span>`}
          <div class="text-secondary mb-3">${th(`vault.h.${k}`)}</div></div>
        <div class="flex gap-2 items-center"><input class="field flex-1 font-mono" .value=${live(this.map![k])} @input=${(e: Event) => { this.map![k] = (e.target as HTMLInputElement).value; }} @change=${() => this.check()} spellcheck="false">
          <button class="btn" @click=${() => this.pickMap(k)}>${t("vault.pickPath")}</button>
          <span class="min-w-[52px] text-xs ${found ? "text-secondary" : req ? "text-late" : "text-secondary mb-3"}">${found ? t("vault.found") : t("vault.missing")}</span></div>
      </div>`;
    })}</div>`;
  }

  render() {
    const st = this.st, h2 = "text-lg font-semibold mt-2.5";
    return html`<main class="grid gap-2.5 max-w-[640px] mx-auto my-10">
      <img class="block h-11 mb-4" src=${mark} alt="">
      <h2 class=${h2}>${t("vault.welcome")}</h2>
      <div class="text-secondary mb-3">${th("vault.intro")}</div>
      <div class="flex gap-2 items-center"><input class="field flex-1 font-mono" readonly .value=${st?.vault ?? ""} placeholder=${t("vault.none")}>
        <button class="btn ${st ? "" : "btn-primary"}" @click=${() => this.pick()}>${t("vault.choose")}</button></div>
      ${st ? html`<h2 class=${h2}>${t("vault.map")}</h2><div class="text-secondary mb-3">${th("vault.mapHelp")}</div>${this.mapping(st)}` : nothing}
      ${st && !st.ok ? html`<div class="text-late text-sm">${th("vault.invalid")}</div>` : nothing}
      <div class="flex gap-2 items-center justify-end">${this.msg ? html`<span class="text-late text-sm">${this.msg}</span>` : nothing}
        <button class="btn btn-primary" ?disabled=${!st?.ok} @click=${() => this.use()}>${t("vault.use")}</button></div>
    </main>`;
  }
}
