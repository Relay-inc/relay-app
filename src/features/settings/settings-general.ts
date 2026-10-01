import { html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { emit } from "../../core/dom";
import { t, th } from "../../core/i18n";
import type { Key } from "../../core/locales/en";
import type { MapKey, VaultMap, VaultStatus } from "../../domain/vault-setup";
import {
  buttonClass,
  field,
  footer,
  OPTIONAL_TEXT,
  section,
  SELECT,
  toggleSwitch,
  inputValue,
  withoutColon,
} from "./blocks";
import "./settings-path";
import { SettingsElement } from "./settings-element";
import { page, tws } from "./styles";
import type { Settings } from "./types";
import type { Accent, Theme } from "../../domain/config";

declare global {
  interface HTMLElementTagNameMap {
    "relay-settings-general": SettingsGeneral;
  }
  interface HTMLElementEventMap {
    "vault-pick": CustomEvent<void>;
    "map-pick": CustomEvent<{ key: MapKey; map: VaultMap }>;
    "map-check": CustomEvent<VaultMap>;
    "folders-save": CustomEvent<VaultMap>;
    "language-change": CustomEvent<string>;
    "theme-change": CustomEvent<Theme>;
    "accent-change": CustomEvent<Accent>;
    "favicons-change": CustomEvent<boolean>;
  }
}

// language names stay in their own language, so they are findable whatever the app is set to
const LANGUAGES = () => [
  ["system", t("set.system")],
  ["en", "English"],
  ["nl", "Nederlands"],
  ["fr", "Français"],
  ["de", "Deutsch"],
];

type PathOptions = {
  found?: boolean | null;
  wide?: boolean;
  readonly?: boolean;
  placeholder?: string;
  onInput?: (value: string) => void;
  onChange?: () => void;
  onPick: () => void;
};

/** General: the vault folder with its mapping, and the interface (language, colour scheme, favicons). */
@customElement("relay-settings-general")
export class SettingsGeneral extends SettingsElement {
  static override styles = [tws, page];

  @property({ type: Boolean, reflect: true }) active = false;
  @property({ attribute: false }) settings!: Settings;
  @property({ attribute: false }) vaultStatus!: VaultStatus;
  /** [key, only when the vault has one, required] per mapped file (src/domain/vault-setup.ts KEYS) */
  @property({ attribute: false }) keys: [MapKey, boolean, boolean][] = [];
  /** The result of the last save */
  @property() message = "";
  @property({ type: Boolean }) ok = false;
  // the vault mapping as it is being edited, bound to the inputs
  private map!: VaultMap;

  override willUpdate(changed: Map<string, unknown>) {
    if (changed.has("vaultStatus")) this.map = { ...this.vaultStatus.map };
  }

  private trimmedMap(): VaultMap {
    return Object.fromEntries(this.keys.map(([key]) => [key, this.map[key].trim()])) as VaultMap;
  }

  private renderPath(value: string, tip: string, options: PathOptions) {
    const { found, wide, readonly, placeholder, onInput, onChange, onPick } = options;
    return html`<relay-settings-path
      .value=${value}
      .tip=${tip}
      .found=${found ?? null}
      ?wide=${wide}
      ?readonly=${readonly}
      .placeholder=${placeholder ?? ""}
      .foundTip=${found == null ? "" : t(found ? "vault.found" : "vault.missing")}
      .pickTip=${t("vault.pickPath")}
      @path-input=${(e: CustomEvent<string>) => onInput?.(e.detail)}
      @path-change=${() => onChange?.()}
      @path-pick=${onPick}
    ></relay-settings-path>`;
  }

  private renderMapping([key, , required]: [MapKey, boolean, boolean]) {
    const { vaultStatus } = this;
    const configured = vaultStatus.map[key];
    const optionalTag = required ? nothing : html` <span class=${OPTIONAL_TEXT}>${t("vault.optional")}</span>`;
    const path = this.renderPath(this.map[key], configured, {
      found: required || configured ? vaultStatus.found[key] : null,
      onInput: value => {
        this.map[key] = value;
      },
      onChange: () => emit(this, "map-check", this.trimmedMap()),
      onPick: () => emit(this, "map-pick", { key, map: this.trimmedMap() }),
    });
    return field(html`${th(`vault.k.${key}` as Key)}${optionalTag}`, path, { hint: th(`vault.h.${key}` as Key) });
  }

  private renderVaultFolder() {
    const { vault } = this.vaultStatus;
    const path = this.renderPath(vault, vault, {
      wide: true,
      readonly: true,
      placeholder: t("vault.none"),
      onPick: () => emit(this, "vault-pick"),
    });
    return section(withoutColon(t("set.vaultLabel")), path, { desc: th("set.vaultHelp") });
  }

  private renderFolders() {
    const save = html`<button
      class=${buttonClass("primary")}
      @click=${() => emit(this, "folders-save", this.trimmedMap())}
    >
      ${t("set.save")}
    </button>`;
    return section(
      t("set.sec.folders"),
      this.keys.map(entry => this.renderMapping(entry)),
      {
        desc: th("vault.mapHelp"),
        footer: footer(this.message, this.ok, save),
      },
    );
  }

  private renderLanguage() {
    const current = this.settings.language || "system";
    const choices = LANGUAGES().map(
      ([code, name]) => html`<option value=${code} ?selected=${current === code}>${name}</option>`,
    );
    return field(
      t("set.language"),
      html`<select class=${SELECT} id="language" @change=${(e: Event) => emit(this, "language-change", inputValue(e))}>
        ${choices}
      </select>`,
      { id: "language", hint: th("set.languageHelp") },
    );
  }

  private renderTheme() {
    const current = this.settings.theme || "system";
    const themes = [
      ["system", t("set.system")],
      ["light", t("set.themeLight")],
      ["dark", t("set.themeDark")],
    ];
    const choices = themes.map(
      ([value, name]) => html`<option value=${value} ?selected=${current === value}>${name}</option>`,
    );
    return field(
      t("set.theme"),
      html`<select
        class=${SELECT}
        id="theme"
        @change=${(e: Event) => emit(this, "theme-change", inputValue(e) as Theme)}
      >
        ${choices}
      </select>`,
      { id: "theme", hint: th("set.themeHelp") },
    );
  }

  private renderAccent() {
    const current = this.settings.accent || "relay";
    const choices = (["relay", "graphite"] as const).map(
      value => html`<option value=${value} ?selected=${current === value}>${t(`set.accent.${value}`)}</option>`,
    );
    return field(
      t("set.accent"),
      html`<select
        class=${SELECT}
        id="accent"
        @change=${(e: Event) => emit(this, "accent-change", inputValue(e) as Accent)}
      >
        ${choices}
      </select>`,
      { id: "accent", hint: th("set.accentHelp") },
    );
  }

  private renderFavicons() {
    const toggle = toggleSwitch("favon", this.settings.favicons?.on !== false, e =>
      emit(this, "favicons-change", (e.target as HTMLInputElement).checked),
    );
    return field(t("set.faviconsOn"), toggle, { id: "favon", hint: th("set.faviconsHelp") });
  }

  override render() {
    return html`${this.renderVaultFolder()} ${this.renderFolders()}
    ${section(t("set.sec.interface"), html`${this.renderLanguage()} ${this.renderTheme()} ${this.renderAccent()} ${this.renderFavicons()}`)}`;
  }
}
