import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { invoke } from "@tauri-apps/api/core";
import { t, th } from "../../core/i18n";
import { emit } from "../../core/dom";
import { tw } from "../../core/styles";
import { KEYS, pickVault, pickMapped, checkMapping, type VaultMap, type VaultStatus } from "../../domain/vault-setup";
import mark from "../../relay-mark.svg";
import type { Settings } from "../../domain/config";

declare global {
  interface HTMLElementEventMap {
    saved: CustomEvent<void>;
  }
}

const HEADING = "text-base font-semibold mt-2.5";
type MapKey = (typeof KEYS)[number][0];

/** First launch, or a vault that is gone: a welcome screen over the main window until a vault is saved (then it removes itself and emits `saved`). */
@customElement("relay-onboard")
export class RelayOnboard extends LitElement {
  static override styles = [
    tw,
    css`
      :host {
        position: fixed;
        inset: 0;
        z-index: 50;
        overflow: auto;
        background: var(--inspector);
        padding: 28px 32px;
        display: block;
      }
    `,
  ];
  // what was configured before (a folder that no longer holds a vault) stays visible, to fix or replace
  @property({ attribute: false }) start?: VaultStatus;
  @state() private status: VaultStatus | null = null;
  @state() private map: VaultMap | null = null; // the paths as typed, checked on change
  @state() private message = "";

  override connectedCallback() {
    super.connectedCallback();
    this.setStatus(this.start?.vault ? this.start : null);
  }

  private setStatus(status: VaultStatus | null) {
    this.status = status;
    this.map = status ? { ...status.map } : null;
  }

  private trimmedMap = (): VaultMap =>
    Object.fromEntries(Object.entries(this.map!).map(([key, path]) => [key, path.trim()])) as VaultMap;

  private async chooseVault() {
    this.message = "";
    const status = await pickVault();
    if (status) this.setStatus(status);
  }

  private async chooseMappedPath(key: MapKey) {
    this.message = "";
    this.setStatus(await pickMapped(this.status!, key, this.trimmedMap()));
  }

  private async checkMap() {
    this.setStatus(await checkMapping(this.status!.vault, this.trimmedMap()));
  }

  private async saveVault() {
    this.message = "";
    try {
      const settings = await invoke<Settings>("get_settings");
      const vault = this.status!.vault;
      await invoke("set_settings", {
        settings: { ...settings, vault, vaults: { ...settings.vaults, [vault]: this.trimmedMap() } },
      });
      this.remove();
      emit(this, "saved");
    } catch (err) {
      this.message = String(err);
    }
  }

  private foundClass(found: boolean, required: boolean) {
    if (found) return "text-secondary";
    return required ? "text-late" : "text-secondary mb-3";
  }

  private renderMapEntry(status: VaultStatus, [key, , required]: (typeof KEYS)[number]) {
    const found = status.found[key];
    return html`<div class="grid gap-1">
      <div class="font-medium">
        ${th(`vault.k.${key}`)}${required ? nothing : html` <span class="text-secondary tabular-nums">${t("vault.optional")}</span>`}
        <div class="text-secondary mb-3">${th(`vault.h.${key}`)}</div>
      </div>
      <div class="flex gap-2 items-center">
        <input
          class="field flex-1 font-mono"
          .value=${live(this.map![key])}
          @input=${(e: Event) => {
            this.map![key] = (e.target as HTMLInputElement).value;
          }}
          @change=${() => this.checkMap()}
          spellcheck="false"
        />
        <button class="btn" @click=${() => this.chooseMappedPath(key)}>${t("vault.pickPath")}</button>
        <span class="min-w-13 text-xs ${this.foundClass(found, required)}"
          >${found ? t("vault.found") : t("vault.missing")}</span
        >
      </div>
    </div>`;
  }

  private renderMapping(status: VaultStatus) {
    return html`<div class="grid gap-2.5">${KEYS.map(entry => this.renderMapEntry(status, entry))}</div>`;
  }

  private renderMappingSection(status: VaultStatus | null) {
    if (!status) return nothing;
    return html`<h2 class=${HEADING}>${t("vault.map")}</h2>
      <div class="text-secondary mb-3">${th("vault.mapHelp")}</div>
      ${this.renderMapping(status)}`;
  }

  override render() {
    const status = this.status;
    return html`<main class="grid gap-2.5 max-w-2xl mx-auto my-10">
      <img class="block h-11 mb-4" src=${mark} alt="" />
      <h2 class=${HEADING}>${t("vault.welcome")}</h2>
      <div class="text-secondary mb-3">${th("vault.intro")}</div>
      <div class="flex gap-2 items-center">
        <input class="field flex-1 font-mono" readonly .value=${status?.vault ?? ""} placeholder=${t("vault.none")} />
        <button class="btn ${status ? "" : "btn-primary"}" @click=${() => this.chooseVault()}>
          ${t("vault.choose")}
        </button>
      </div>
      ${this.renderMappingSection(status)}
      ${status && !status.ok ? html`<div class="text-late text-sm">${th("vault.invalid")}</div>` : nothing}
      <div class="flex gap-2 items-center justify-end">
        ${this.message ? html`<span class="text-late text-sm">${this.message}</span>` : nothing}
        <button class="btn btn-primary" ?disabled=${!status?.ok} @click=${() => this.saveVault()}>
          ${t("vault.use")}
        </button>
      </div>
    </main>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-onboard": RelayOnboard;
  }
}
