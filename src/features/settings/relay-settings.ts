import { css, html, nothing } from "lit";
import { ifDefined } from "lit/directives/if-defined.js";
import { customElement, state } from "lit/decorators.js";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { initI18n, t } from "../../core/i18n";
import { applyTheme } from "../../core/theme";
import type { Theme } from "../../domain/config";
import type { Key } from "../../core/locales/en";
import {
  KEYS,
  pickVault,
  pickMapped,
  checkMapping,
  type MapKey,
  type VaultMap,
  type VaultStatus,
} from "../../domain/vault-setup";
import { appIcon } from "./blocks";
import "./settings-agents";
import "./settings-general";
import "./settings-integrations";
import "./settings-projects";
import { SettingsElement } from "./settings-element";
import { tws } from "./styles";
import type { SaveSettings, Settings } from "./types";

declare global {
  interface HTMLElementTagNameMap {
    "relay-settings": RelaySettings;
  }
}

// The settings window, laid out like bb's: the pages in a sidebar on the left, the window title follows the page.
// General holds the vault folder with its mapping and the language, Projects the projects the user customised,
// Agents the coding-agent CLIs (packages/agent-*: switched on, the default, the program), Integrations the external services (the board providers
// from packages/integration-*, GitHub, Mail), one sidebar page each. Saving emits "settings-changed" from the backend, the main window follows it.
const TABS = [
  ["general", "set.tab.general", "gear"],
  ["projects", "set.tab.projects", "folder"],
  ["agents", "set.tab.agents", "agent"],
  ["integrations", "set.tab.integrations", "plug"],
] as const satisfies readonly (readonly [string, Key, string])[];
type Tab = (typeof TABS)[number][0];

/** The window: the sidebar, the title, the keys, links, and the settings as saved, which the pages show and change. */
@customElement("relay-settings")
export class RelaySettings extends SettingsElement {
  static override styles = [
    tws,
    css`
      :host {
        display: block;
        width: 100%;
        height: 100%;
        min-height: 0;
      }
    `,
  ];

  @state() private settings?: Settings;
  @state() private vaultStatus?: VaultStatus;
  @state() private message = "";
  @state() private ok = false;
  @state() private tab: Tab = TABS.find(x => x[0] === localStorage.getItem("prefsTab"))?.[0] ?? "general";

  private onKeydown = (e: KeyboardEvent) => {
    if (e.key === "Escape" || (e.metaKey && e.key === "w")) window.close();
    // Cmd-1 to 4 jump to a page
    const pageNumber = e.metaKey && !e.altKey && !e.shiftKey ? Number(e.key) : 0;
    if (pageNumber >= 1 && pageNumber <= TABS.length) {
      e.preventDefault();
      this.go(TABS[pageNumber - 1][0]);
    }
  };

  override connectedCallback() {
    super.connectedCallback();
    window.addEventListener("keydown", this.onKeydown);
    this.init();
  }
  override disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("keydown", this.onKeydown);
  }
  private async init() {
    const settings = await invoke<Settings>("get_settings");
    this.vaultStatus = await invoke<VaultStatus>("vault_status");
    await initI18n();
    applyTheme(settings.theme);
    this.settings = settings;
  }

  override updated() {
    if (!this.settings) return;
    const title = t(TABS.find(x => x[0] === this.tab)![1]);
    getCurrentWindow()
      .setTitle(title)
      .catch(() => {});
    document.title = title;
  }

  private go(to: Tab) {
    this.tab = to;
    localStorage.setItem("prefsTab", to);
    this.message = "";
  }
  // a web link (Google's app password page) opens in the browser, the settings window never navigates
  private onClick = (e: MouseEvent) => {
    const link = e
      .composedPath()
      .find((node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement && node.href.startsWith("https:"));
    if (link) {
      e.preventDefault();
      invoke("plugin:opener|open_url", { url: link.href });
    }
  };

  private async save({ settings, done }: SaveSettings) {
    try {
      this.settings = await invoke<Settings>("set_settings", { settings });
      this.vaultStatus = await invoke<VaultStatus>("vault_status");
      this.message = done;
      this.ok = true;
    } catch (e) {
      this.message = String(e);
      this.ok = false;
    }
  }
  private async changeLanguage(language: string) {
    await this.save({ settings: { ...this.settings!, language }, done: "" });
    await initI18n();
    window.dispatchEvent(new Event("settings-lang"));
  }

  private async changeTheme(theme: Theme) {
    applyTheme(theme);
    await this.save({ settings: { ...this.settings!, theme }, done: "" });
  }

  private async pickVaultFolder(current: VaultStatus) {
    this.vaultStatus = { ...((await pickVault()) ?? current) };
    this.message = "";
  }
  private async pickMappedFile(current: VaultStatus, { key, map }: { key: MapKey; map: VaultMap }) {
    this.vaultStatus = await pickMapped(current, key, map);
  }
  private async checkMap(current: VaultStatus, map: VaultMap) {
    this.vaultStatus = await checkMapping(current.vault, map);
  }
  private saveFolders(settings: Settings, vault: string, map: VaultMap) {
    const vaults = { ...settings.vaults, [vault]: map };
    return this.save({ settings: { ...settings, vault, vaults }, done: t("set.saved") });
  }
  private saveFavicons(settings: Settings, on: boolean) {
    const favicons = { last: "", tried: {}, ...settings.favicons, on };
    return this.save({ settings: { ...settings, favicons }, done: "" });
  }
  private onSettingsChanged = (e: CustomEvent<Settings>) => {
    this.settings = e.detail;
  };

  private renderTabs(current: Tab) {
    return html`<nav class="w-50 flex-none overflow-y-auto border-r border-s-seam bg-s-side px-2 py-3 select-none">
      <div class="mt-1 grid gap-0.5 first:mt-0">
        ${TABS.map(
          ([id, name, glyph]) =>
            html`<button
              class="flex h-7 items-center gap-2 overflow-hidden rounded-md px-2 text-sm text-s-fg hover:bg-s-sel focus-visible:ring-2 ring-s-ring focus-visible:outline-none ${current === id ? "bg-s-sel" : ""}"
              @click=${() => this.go(id)}
              aria-current=${ifDefined(current === id ? "page" : undefined)}
            >
              ${appIcon(glyph, "size-4 flex-none fill-none stroke-current stroke-2 glyph")}<span
                class="min-w-0 flex-1 truncate text-left"
                >${t(name)}</span
              >
            </button>`,
        )}
      </div>
    </nav>`;
  }

  private renderGeneral(settings: Settings, vaultStatus: VaultStatus) {
    return html`<relay-settings-general
      ?active=${this.tab === "general"}
      .settings=${settings}
      .vaultStatus=${vaultStatus}
      .keys=${KEYS}
      .message=${this.message}
      .ok=${this.ok}
      @vault-pick=${() => this.pickVaultFolder(vaultStatus)}
      @map-pick=${(e: CustomEvent<{ key: MapKey; map: VaultMap }>) => this.pickMappedFile(vaultStatus, e.detail)}
      @map-check=${(e: CustomEvent<VaultMap>) => this.checkMap(vaultStatus, e.detail)}
      @folders-save=${(e: CustomEvent<VaultMap>) => this.saveFolders(settings, vaultStatus.vault, e.detail)}
      @language-change=${(e: CustomEvent<string>) => this.changeLanguage(e.detail)}
      @theme-change=${(e: CustomEvent<Theme>) => this.changeTheme(e.detail)}
      @favicons-change=${(e: CustomEvent<boolean>) => this.saveFavicons(settings, e.detail)}
    ></relay-settings-general>`;
  }

  override render() {
    const { settings, vaultStatus, tab } = this;
    if (!settings || !vaultStatus) return nothing;
    return html`<div class="flex h-full min-h-0" @click=${this.onClick}>
      ${this.renderTabs(tab)}
      <section class="min-w-0 flex-1 min-h-0 overflow-y-auto px-6 pt-5 pb-6">
        <div class="mx-auto grid max-w-2xl grid-cols-1 content-start gap-8 [&>*]:min-w-0">
          ${this.renderGeneral(settings, vaultStatus)}
          <relay-settings-projects
            ?active=${tab === "projects"}
            .settings=${settings}
            .message=${this.message}
            .ok=${this.ok}
            @save-settings=${(e: CustomEvent<SaveSettings>) => this.save(e.detail)}
          ></relay-settings-projects>
          <relay-settings-agents
            ?active=${tab === "agents"}
            .settings=${settings}
            @settings-changed=${this.onSettingsChanged}
          ></relay-settings-agents>
          <relay-settings-integrations
            ?active=${tab === "integrations"}
            .settings=${settings}
            @settings-changed=${this.onSettingsChanged}
          ></relay-settings-integrations>
        </div>
      </section>
    </div>`;
  }
}
