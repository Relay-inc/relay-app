import { css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { invoke } from "@tauri-apps/api/core";
import { t } from "../../core/i18n";
import type { Key } from "../../core/locales/en";
import { ERROR_MESSAGE, field, section, SELECT, toggleSwitch } from "./blocks";
import { SettingsElement } from "./settings-element";
import { tws } from "./styles";

declare global {
  interface HTMLElementTagNameMap {
    "relay-settings-actions": SettingsActions;
  }
}

type Policy = "auto" | "ask" | "deny";
type ActionMeta = { ext: string; id: string; about: string; write: boolean; default: Policy };
/** An extension's entry in the vault's .relay/config.json `actions`: `access` and a policy per action or `*`. */
type Entry = Record<string, string | boolean>;
type ActionConfig = { actions: ActionMeta[]; config: Record<string, Entry | string> };

const POLICIES: Policy[] = ["auto", "ask", "deny"];

/** Agent access for one extension: whether agents may use it through `relay` at all, and per action whether it runs,
 *  asks first or never runs. Reads and writes the vault's .relay/config.json itself (actions.rs). */
@customElement("relay-settings-actions")
export class SettingsActions extends SettingsElement {
  static override styles = [
    tws,
    css`
      :host {
        display: block;
      }
    `,
  ];
  @property() ext = "";
  @property() name = "";
  @state() private actions: ActionMeta[] = [];
  @state() private entry: Entry = {};
  @state() private error = "";

  override connectedCallback() {
    super.connectedCallback();
    invoke<ActionConfig>("action_config")
      .then(({ actions, config }) => {
        this.actions = actions.filter(action => action.ext === this.ext);
        this.entry = entryOf(config[this.ext]);
      })
      .catch(error => (this.error = String(error)));
  }

  private async save(entry: Entry) {
    try {
      const config = await invoke<ActionConfig["config"]>("set_action_config", { ext: this.ext, entry });
      this.entry = entryOf(config[this.ext]);
      this.error = "";
    } catch (error) {
      this.error = String(error);
    }
  }
  // default values stay out of the file: access on, a policy left to its default
  private set(key: string, value: string | boolean) {
    const next = { ...this.entry, [key]: value };
    if (value === "" || (key === "access" && value === true)) delete next[key];
    this.save(next);
  }

  private renderAction(action: ActionMeta) {
    const inherited = (this.entry["*"] as Policy) || action.default;
    const current = String(this.entry[action.id] ?? "");
    const select = html`<select
      class=${SELECT}
      id="act-${action.id}"
      @change=${(e: Event) => this.set(action.id, (e.target as HTMLSelectElement).value)}
    >
      <option value="" ?selected=${!current}>${t("act.default", { p: t(`act.${inherited}` as Key) })}</option>
      ${POLICIES.map(policy => html`<option value=${policy} ?selected=${current === policy}>${t(`act.${policy}` as Key)}</option>`)}
    </select>`;
    return field(html`<code class="text-xs">${this.ext}.${action.id}</code>`, select, {
      id: `act-${action.id}`,
      hint: action.about,
    });
  }

  override render() {
    if (!this.actions.length && !this.error) return nothing;
    const on = this.entry.access !== false;
    const access = field(
      t("act.access", { name: this.name }),
      toggleSwitch(`acc-${this.ext}`, on, e => this.set("access", (e.target as HTMLInputElement).checked)),
      { id: `acc-${this.ext}`, hint: this.ext === "mail" ? t("act.mailOnly") : undefined },
    );
    return section(
      t("act.title"),
      html`${access}${on ? this.actions.map(action => this.renderAction(action)) : nothing}`,
      {
        desc: t("act.help", { name: this.name }),
        footer: this.error ? html`<span class=${ERROR_MESSAGE}>${this.error}</span>` : nothing,
      },
    );
  }
}

/** A plain "auto" in the file means every action: as an entry, that is `*`. */
const entryOf = (entry: Entry | string | undefined): Entry =>
  typeof entry === "string" ? { "*": entry } : { ...(entry || {}) };
