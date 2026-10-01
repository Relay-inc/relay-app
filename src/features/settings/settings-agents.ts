import { html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "../../core/dom";
import { t, th } from "../../core/i18n";
import { agent, agentsStatus, type AgentsStatus, type AgentStatus } from "../../domain/agents";
import { btn, foot, PILL, sec, SELECT, SEMPTY, ST, st, TILE, val } from "./blocks";
import { glyphSvg } from "../../core/icons";
import "./settings-agent";
import "./settings-fold";
import "./settings-menu";
import { SettingsElement } from "./settings-element";
import { page, tws } from "./styles";
import type { Settings } from "./types";

declare global {
  interface HTMLElementTagNameMap {
    "relay-settings-agents": SettingsAgents;
  }
  interface HTMLElementEventMap {
    "settings-changed": CustomEvent<Settings>;
  }
}

const agGlyph = (id: string) => {
  const ap = agent(id);
  return ap ? glyphSvg(ap.glyph, TILE, "0 0 16 16") : nothing;
};

/** Agents: only the ones switched on are listed, the others are in the Add menu. A row folds open to its program and
 *  options. Every change saves at once. */
@customElement("relay-settings-agents")
export class SettingsAgents extends SettingsElement {
  static override styles = [tws, page];

  @property({ type: Boolean, reflect: true }) active = false;
  @property({ attribute: false }) settings!: Settings;
  // what the backend detects per provider (installed, version, login), checked when the window opens
  @state() private agSt: AgentsStatus | null = null;
  @state() private agMsg = "";
  @state() private agOk = false;
  // which rows are folded open
  @state() private opened = new Set<string>();

  override connectedCallback() {
    super.connectedCallback();
    this.check();
  }

  private cfg = (id: string) => this.settings.agents?.providers[id] ?? { on: false, bin: "" };
  private status(p: AgentStatus) {
    const d = p.detect;
    const found = d.installed
      ? d.version
        ? t("ag.installed", { version: d.version })
        : t("ag.installedNoVersion")
      : t("ag.missing", { bin: d.bin });
    const login = d.loggedIn == null ? "" : ` · ${d.loggedIn ? t("ag.loggedIn") : t("ag.loggedOut")}`;
    return st(!d.installed ? "off" : d.loggedIn === false ? "warn" : "ok", found + login);
  }
  // one change to settings.agents, saved; the backend keeps the default on a switched-on agent
  private async save(change: (a: Settings["agents"]) => void) {
    const agents = structuredClone(this.settings.agents);
    change(agents);
    try {
      emit(
        this,
        "settings-changed",
        await invoke<Settings>("set_settings", { settings: { ...this.settings, agents } }),
      );
      this.agMsg = "";
      this.agOk = true;
    } catch (x) {
      this.agMsg = String(x);
      this.agOk = false;
    }
  }
  private async check(quiet = false) {
    if (!quiet) this.agSt = null;
    try {
      this.agSt = await agentsStatus();
    } catch (e) {
      this.agMsg = String(e);
      this.agOk = false;
    }
  }
  private toggle(id: string) {
    const o = new Set(this.opened);
    if (!o.delete(id)) o.add(id);
    this.opened = o;
  }
  // add (folded open, to set it up) and remove
  private async switchTo(id: string, on: boolean) {
    const o = new Set(this.opened);
    if (on) o.add(id);
    else o.delete(id);
    this.opened = o;
    await this.save(a => {
      a.providers[id] = { ...a.providers[id], on };
    });
  }

  private row(p: AgentStatus) {
    const { settings } = this,
      id = p.id;
    return html`<relay-settings-fold
      ?open=${this.opened.has(id)}
      @fold-toggle=${() => this.toggle(id)}
      .ico=${agGlyph(id)}
      .state=${this.status(p)}
      .name=${html`${p.name}${settings.agents?.default === id ? html` <span class=${PILL}>${t("ag.isDefault")}</span>` : nothing}`}
    >
      ${
        this.opened.has(id)
          ? html`<relay-settings-agent
              .status=${p}
              .cfg=${this.cfg(id)}
              .agent=${agent(id)}
              @agent-bin=${async (e: CustomEvent<string>) => {
                await this.save(a => {
                  a.providers[id] = { ...a.providers[id], bin: e.detail };
                });
                this.check(true);
              }}
              @agent-option=${(e: CustomEvent<{ id: string; value: string }>) =>
                this.save(a => {
                  a.providers[id] = { ...a.providers[id], [e.detail.id]: e.detail.value };
                })}
              @agent-remove=${() => this.switchTo(id, false)}
            ></relay-settings-agent>`
          : nothing
      }
    </relay-settings-fold>`;
  }

  override render() {
    const { agSt, settings } = this;
    if (!agSt)
      return sec(
        t("set.tab.agents"),
        html`<div class=${ST}><span class="spinner"></span>${this.agMsg || t("ag.checking")}</div>`,
      );
    const act = agSt.providers.filter(p => this.cfg(p.id).on),
      rest = agSt.providers.filter(p => !this.cfg(p.id).on);
    return html`${sec(
      t("set.tab.agents"),
      act.length ? act.map(p => this.row(p)) : html`<div class=${SEMPTY}>${t("ag.empty")}</div>`,
      {
        desc: th("ag.listHelp"),
        list: true,
        foot: this.agMsg ? foot(this.agMsg, this.agOk, nothing) : nothing,
        action: html`<button
            class=${btn("ghost")}
            @click=${() => {
              this.agMsg = "";
              this.check(true);
            }}
          >
            ${t("ag.recheck")}
          </button>
          <relay-settings-menu
            .label=${t("ag.add")}
            .items=${rest.map(p => ({ id: p.id, ico: agGlyph(p.id), name: p.name, state: this.status(p) }))}
            @menu-pick=${(e: CustomEvent<string>) => this.switchTo(e.detail, true)}
          ></relay-settings-menu>`,
      },
    )}
    ${
      /* with one agent there is nothing to choose */ act.length > 1
        ? sec(t("ag.default"), nothing, {
            desc: th("ag.defaultHelp"),
            action: html`<select
              class=${SELECT}
              id="agdefault"
              aria-label=${t("ag.default")}
              @change=${(e: Event) => {
                const v = val(e);
                return this.save(a => {
                  a.default = v;
                });
              }}
            >
              ${act.map(
                p => html`<option value=${p.id} ?selected=${settings.agents?.default === p.id}>${p.name}</option>`,
              )}
            </select>`,
          })
        : nothing
    }`;
  }
}
