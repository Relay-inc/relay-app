import { html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "../../core/dom";
import { t, th } from "../../core/i18n";
import { agent, agentsStatus, type AgentsStatus, type AgentStatus } from "../../domain/agents";
import {
  buttonClass,
  footer,
  DEFAULT_PILL,
  section,
  SELECT,
  EMPTY_LIST,
  STATUS_TEXT,
  statusLine,
  TILE,
  inputValue,
} from "./blocks";
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

const agentGlyph = (id: string) => {
  const provider = agent(id);
  return provider ? glyphSvg(provider.glyph, TILE, "0 0 16 16") : nothing;
};

type AgentsConfig = Settings["agents"];

/** Agents: only the ones switched on are listed, the others are in the Add menu. A row folds open to its program and
 *  options. Every change saves at once. */
@customElement("relay-settings-agents")
export class SettingsAgents extends SettingsElement {
  static override styles = [tws, page];

  @property({ type: Boolean, reflect: true }) active = false;
  @property({ attribute: false }) settings!: Settings;
  // what the backend detects per provider (installed, version, login), checked when the window opens
  @state() private detected: AgentsStatus | null = null;
  @state() private message = "";
  @state() private ok = false;
  // which rows are folded open
  @state() private opened = new Set<string>();

  override connectedCallback() {
    super.connectedCallback();
    this.check();
  }

  private config = (id: string) => this.settings.agents?.providers[id] ?? { on: false, bin: "" };

  private statusOf(provider: AgentStatus) {
    const detect = provider.detect;
    const found = this.foundText(provider);
    const login = detect.loggedIn == null ? "" : ` · ${detect.loggedIn ? t("ag.loggedIn") : t("ag.loggedOut")}`;
    return statusLine(this.statusLevel(provider), found + login);
  }
  private foundText({ detect }: AgentStatus) {
    if (!detect.installed) return t("ag.missing", { bin: detect.bin });
    return detect.version ? t("ag.installed", { version: detect.version }) : t("ag.installedNoVersion");
  }
  private statusLevel({ detect }: AgentStatus) {
    if (!detect.installed) return "off";
    return detect.loggedIn === false ? "warn" : "ok";
  }

  // one change to settings.agents, saved; the backend keeps the default on a switched-on agent
  private async save(change: (agents: AgentsConfig) => void) {
    const agents = structuredClone(this.settings.agents);
    change(agents);
    try {
      const saved = await invoke<Settings>("set_settings", { settings: { ...this.settings, agents } });
      emit(this, "settings-changed", saved);
      this.message = "";
      this.ok = true;
    } catch (error) {
      this.message = String(error);
      this.ok = false;
    }
  }
  private async check(quiet = false) {
    if (!quiet) this.detected = null;
    try {
      this.detected = await agentsStatus();
    } catch (error) {
      this.message = String(error);
      this.ok = false;
    }
  }
  private setOpen(id: string, open: boolean) {
    const opened = new Set(this.opened);
    if (open) opened.add(id);
    else opened.delete(id);
    this.opened = opened;
  }
  private saveProvider(id: string, changes: Record<string, unknown>) {
    return this.save(agents => {
      agents.providers[id] = { ...agents.providers[id], ...changes };
    });
  }
  // add (folded open, to set it up) and remove
  private async switchTo(id: string, on: boolean) {
    this.setOpen(id, on);
    await this.saveProvider(id, { on });
  }

  private renderRowBody(provider: AgentStatus) {
    const id = provider.id;
    return html`<relay-settings-agent
      .status=${provider}
      .config=${this.config(id)}
      .agent=${agent(id)}
      @agent-bin=${async (e: CustomEvent<string>) => {
        await this.saveProvider(id, { bin: e.detail });
        this.check(true);
      }}
      @agent-option=${(e: CustomEvent<{ id: string; value: string }>) =>
        this.saveProvider(id, { [e.detail.id]: e.detail.value })}
      @agent-remove=${() => this.switchTo(id, false)}
    ></relay-settings-agent>`;
  }

  private renderRow(provider: AgentStatus) {
    const id = provider.id;
    const open = this.opened.has(id);
    const defaultBadge =
      this.settings.agents?.default === id ? html` <span class=${DEFAULT_PILL}>${t("ag.isDefault")}</span>` : nothing;
    return html`<relay-settings-fold
      ?open=${open}
      @fold-toggle=${() => this.setOpen(id, !open)}
      .icon=${agentGlyph(id)}
      .status=${this.statusOf(provider)}
      .name=${html`${provider.name}${defaultBadge}`}
    >
      ${open ? this.renderRowBody(provider) : nothing}
    </relay-settings-fold>`;
  }

  private renderListActions(unused: AgentStatus[]) {
    const items = unused.map(provider => ({
      id: provider.id,
      icon: agentGlyph(provider.id),
      name: provider.name,
      status: this.statusOf(provider),
    }));
    return html`<button
        class=${buttonClass("ghost")}
        @click=${() => {
          this.message = "";
          this.check(true);
        }}
      >
        ${t("ag.recheck")}
      </button>
      <relay-settings-menu
        .label=${t("ag.add")}
        .items=${items}
        @menu-pick=${(e: CustomEvent<string>) => this.switchTo(e.detail, true)}
      ></relay-settings-menu>`;
  }

  private renderDefaultChoice(listed: AgentStatus[]) {
    // with one agent there is nothing to choose
    if (listed.length < 2) return nothing;
    const options = listed.map(
      provider =>
        html`<option value=${provider.id} ?selected=${this.settings.agents?.default === provider.id}>
          ${provider.name}
        </option>`,
    );
    const select = html`<select
      class=${SELECT}
      id="agdefault"
      aria-label=${t("ag.default")}
      @change=${(e: Event) => {
        const chosen = inputValue(e);
        return this.save(agents => {
          agents.default = chosen;
        });
      }}
    >
      ${options}
    </select>`;
    return section(t("ag.default"), nothing, { desc: th("ag.defaultHelp"), action: select });
  }

  override render() {
    const detected = this.detected;
    if (!detected)
      return section(
        t("set.tab.agents"),
        html`<div class=${STATUS_TEXT}><span class="spinner"></span>${this.message || t("ag.checking")}</div>`,
      );
    const listed = detected.providers.filter(provider => this.config(provider.id).on);
    const unused = detected.providers.filter(provider => !this.config(provider.id).on);
    const rows = listed.length
      ? listed.map(provider => this.renderRow(provider))
      : html`<div class=${EMPTY_LIST}>${t("ag.empty")}</div>`;
    return html`${section(t("set.tab.agents"), rows, {
      desc: th("ag.listHelp"),
      list: true,
      footer: this.message ? footer(this.message, this.ok, nothing) : nothing,
      action: this.renderListActions(unused),
    })}
    ${this.renderDefaultChoice(listed)}`;
  }
}
