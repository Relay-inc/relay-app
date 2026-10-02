import { html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { emit } from "../../core/dom";
import { t, th } from "../../core/i18n";
import type { Key } from "../../core/locales/en";
import type { MapKey, VaultMap, VaultStatus } from "../../domain/vault-setup";
import {
  appIcon,
  buttonClass,
  field,
  footer,
  OPTIONAL_TEXT,
  section,
  SELECT,
  toggleSwitch,
  inputValue,
  withoutColon,
  TILE,
} from "./blocks";
import { glyphSvg } from "../../core/icons";
import { PROVIDERS } from "../../domain/providers";
import { viewItems, type ViewItem } from "../../domain/sidebar-views";
import { arranged, isHidden } from "../../domain/sidebar-order";
import "./settings-path";
import { SettingsElement } from "./settings-element";
import { page, tws } from "./styles";
import type { Settings } from "./types";
import type { Accent, SidebarCfg, TerminalApp, Theme } from "../../domain/config";

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
    "terminal-change": CustomEvent<TerminalApp>;
    "sidebar-change": CustomEvent<SidebarCfg>;
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
    ] as const;
    const control = html`<div class="seg" role="radiogroup" aria-label=${t("set.theme")}>
      ${themes.map(
        ([value, name]) =>
          html`<button
            role="radio"
            aria-checked=${current === value}
            class=${current === value ? "on" : ""}
            @click=${() => emit(this, "theme-change", value as Theme)}
          >
            ${name}
          </button>`,
      )}
    </div>`;
    return field(t("set.theme"), control, { hint: th("set.themeHelp") });
  }

  private renderAccent() {
    const current = this.settings.accent || "relay";
    // Relay blue is the fixed brand colour (it must not follow the current accent); graphite is the text colour
    const swatch = { relay: "bg-[#3a5ffb]", graphite: "bg-label" };
    const control = html`<div class="flex gap-2.5" role="radiogroup" aria-label=${t("set.accent")}>
      ${(["relay", "graphite"] as const).map(
        value =>
          html`<button
            role="radio"
            aria-checked=${current === value}
            class="flex h-7 items-center gap-1.5 rounded-lg border bg-transparent pr-2.5 pl-1.5 text-xs font-medium text-s-fg focus-visible:ring-1 ring-s-primary focus-visible:outline-none ${current === value ? "border-accent" : "border-s-input"}"
            @click=${() => emit(this, "accent-change", value)}
          >
            <span class="size-4 rounded-full inset-ring inset-ring-black/10 ${swatch[value]}"></span
            >${t(`set.accent.${value}`)}
          </button>`,
      )}
    </div>`;
    return field(t("set.accent"), control, { hint: th("set.accentHelp") });
  }

  private renderFavicons() {
    const toggle = toggleSwitch("favon", this.settings.favicons?.on !== false, e =>
      emit(this, "favicons-change", (e.target as HTMLInputElement).checked),
    );
    return field(t("set.faviconsOn"), toggle, { id: "favon", hint: th("set.faviconsHelp") });
  }

  private renderTerminal() {
    const current = this.settings.terminal || "auto";
    const choices = [
      ["auto", t("set.terminalAuto")],
      ["iterm", "iTerm"],
      ["wezterm", "WezTerm"],
      ["terminal", "Terminal"],
    ].map(([value, name]) => html`<option value=${value} ?selected=${current === value}>${name}</option>`);
    return field(
      t("set.terminal"),
      html`<select
        class=${SELECT}
        id="terminal"
        @change=${(e: Event) => emit(this, "terminal-change", inputValue(e) as TerminalApp)}
      >
        ${choices}
      </select>`,
      { id: "terminal", hint: th("set.terminalHelp") },
    );
  }

  private renderSidebarLayout(cfg: SidebarCfg) {
    const current = cfg.layout ?? "list";
    const layouts = [
      ["list", t("set.sidebarList")],
      ["icons", t("set.sidebarIcons")],
    ] as const;
    const control = html`<div class="seg" role="radiogroup" aria-label=${t("set.sidebarLayout")}>
      ${layouts.map(
        ([value, name]) =>
          html`<button
            role="radio"
            aria-checked=${current === value}
            class=${current === value ? "on" : ""}
            @click=${() => emit(this, "sidebar-change", { layout: value })}
          >
            ${name}
          </button>`,
      )}
    </div>`;
    return field(t("set.sidebarLayout"), control, { hint: th("set.sidebarLayoutHelp") });
  }

  // one switch per view, in the order of the sidebar
  private renderSidebarItem(item: ViewItem, cfg: SidebarCfg) {
    const id = `sb-${item.key}`;
    const shown = !isHidden(item.key, cfg);
    const glyph = item.mark ? glyphSvg(item.mark, TILE, "0 0 24 24") : appIcon(item.icon ?? "", TILE);
    const toggle = toggleSwitch(id, shown, e => {
      const on = (e.target as HTMLInputElement).checked;
      const hidden = (cfg.hidden ?? []).filter(key => key !== item.key);
      emit(this, "sidebar-change", { hidden: on ? hidden : [...hidden, item.key] });
    });
    return field(html`<span class="inline-flex items-center gap-2">${glyph}${item.name}</span>`, toggle, { id });
  }

  private renderSidebar() {
    const { settings } = this;
    const cfg = settings.sidebar ?? {};
    const boards = PROVIDERS.filter(board => settings.integrations[board.id]?.on);
    const items = arranged(viewItems(boards, !!settings.github?.on, !!settings.mail?.on), cfg);
    const reset = cfg.order?.length
      ? html`<button class=${buttonClass()} @click=${() => emit(this, "sidebar-change", { order: [] })}>
          ${t("nav.resetOrder")}
        </button>`
      : nothing;
    return section(
      t("set.sec.sidebar"),
      html`${this.renderSidebarLayout(cfg)} ${field(t("set.sidebarItems"), reset, { hint: th("set.sidebarItemsHelp") })}
      ${items.map(item => this.renderSidebarItem(item, cfg))}`,
    );
  }

  override render() {
    return html`${this.renderVaultFolder()} ${this.renderFolders()}
    ${section(t("set.sec.interface"), html`${this.renderLanguage()} ${this.renderTheme()} ${this.renderAccent()} ${this.renderFavicons()} ${this.renderTerminal()}`)}
    ${this.renderSidebar()}`;
  }
}
