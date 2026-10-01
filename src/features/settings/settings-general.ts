import { html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { emit } from "../../core/dom";
import { t, th } from "../../core/i18n";
import type { Key } from "../../core/locales/en";
import type { MapKey, VaultMap, VaultStatus } from "../../domain/vault-setup";
import { btn, field, foot, nc, OPT, sec, SELECT, sw, val } from "./blocks";
import "./settings-path";
import { SettingsElement } from "./settings-element";
import { page, tws } from "./styles";
import type { Settings } from "./types";

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
    "favicons-change": CustomEvent<boolean>;
  }
}

// language names stay in their own language, so they are findable whatever the app is set to
const LANG_OPTS = () => [
  ["system", t("set.system")],
  ["en", "English"],
  ["nl", "Nederlands"],
  ["fr", "Français"],
  ["de", "Deutsch"],
];

/** General: the vault folder with its mapping, and the interface (language, favicons). */
@customElement("relay-settings-general")
export class SettingsGeneral extends SettingsElement {
  static override styles = [tws, page];

  @property({ type: Boolean, reflect: true }) active = false;
  @property({ attribute: false }) settings!: Settings;
  @property({ attribute: false }) vs!: VaultStatus;
  /** [key, only when the vault has one, required] per mapped file (src/domain/vault-setup.ts KEYS) */
  @property({ attribute: false }) keys: [MapKey, boolean, boolean][] = [];
  /** The result of the last save */
  @property() msg = "";
  @property({ type: Boolean }) ok = false;
  // the vault mapping as it is being edited, bound to the inputs
  private map!: VaultMap;

  override willUpdate(changed: Map<string, unknown>) {
    if (changed.has("vs")) this.map = { ...this.vs.map };
  }

  private trimmed(): VaultMap {
    return Object.fromEntries(this.keys.map(([k]) => [k, this.map[k].trim()])) as VaultMap;
  }
  private path(
    value: string,
    tip: string,
    o: {
      found?: boolean | null;
      wide?: boolean;
      readonly?: boolean;
      placeholder?: string;
      input?: (v: string) => void;
      change?: () => void;
      pick: () => void;
    },
  ) {
    return html`<relay-settings-path
      .value=${value}
      .tip=${tip}
      .found=${o.found ?? null}
      ?wide=${o.wide}
      ?readonly=${o.readonly}
      .placeholder=${o.placeholder ?? ""}
      .foundTip=${o.found == null ? "" : t(o.found ? "vault.found" : "vault.missing")}
      .pickTip=${t("vault.pickPath")}
      @path-input=${(e: CustomEvent<string>) => o.input?.(e.detail)}
      @path-change=${() => o.change?.()}
      @path-pick=${o.pick}
    ></relay-settings-path>`;
  }

  override render() {
    const { vs, settings } = this;
    const maps = this.keys.map(([k, , req]) =>
      field(
        html`${th(`vault.k.${k}` as Key)}${req ? nothing : html` <span class=${OPT}>${t("vault.optional")}</span>`}`,
        this.path(this.map[k], vs.map[k], {
          found: req || vs.map[k] ? vs.found[k] : null,
          input: v => {
            this.map[k] = v;
          },
          change: () => emit(this, "map-check", this.trimmed()),
          pick: () => emit(this, "map-pick", { key: k, map: this.trimmed() }),
        }),
        { hint: th(`vault.h.${k}` as Key) },
      ),
    );
    return html`${sec(
      nc(t("set.vaultLabel")),
      this.path(vs.vault, vs.vault, {
        wide: true,
        readonly: true,
        placeholder: t("vault.none"),
        pick: () => emit(this, "vault-pick"),
      }),
      { desc: th("set.vaultHelp") },
    )}
    ${sec(t("set.sec.folders"), maps, { desc: th("vault.mapHelp"), foot: foot(this.msg, this.ok, html`<button class=${btn("primary")} @click=${() => emit(this, "folders-save", this.trimmed())}>${t("set.save")}</button>`) })}
    ${sec(
      t("set.sec.interface"),
      html` ${field(
        t("set.language"),
        html`<select class=${SELECT} id="language" @change=${(e: Event) => emit(this, "language-change", val(e))}>
          ${LANG_OPTS().map(
            ([v, name]) => html`<option value=${v} ?selected=${(settings.language || "system") === v}>${name}</option>`,
          )}
        </select>`,
        { id: "language", hint: th("set.languageHelp") },
      )}
      ${field(
        t("set.faviconsOn"),
        sw("favon", settings.favicons?.on !== false, e =>
          emit(this, "favicons-change", (e.target as HTMLInputElement).checked),
        ),
        { id: "favon", hint: th("set.faviconsHelp") },
      )}`,
    )}`;
  }
}
