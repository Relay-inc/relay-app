import { invoke } from "@tauri-apps/api/core";
import { html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { emit } from "../../core/dom";
import { at, ath, t } from "../../core/i18n";
import type { AgentProvider, AgentStatus } from "../../domain/agents";
import {
  buttonClass,
  field,
  FIELD,
  FIELD_CHIP,
  HINT_IN_ROW,
  withoutColon,
  PILL,
  SELECT,
  inputValue,
  toggleSwitch,
} from "./blocks";
import { SettingsElement } from "./settings-element";
import { tws } from "./styles";

declare global {
  interface HTMLElementTagNameMap {
    "relay-settings-agent": SettingsAgent;
  }
  interface HTMLElementEventMap {
    "agent-bin": CustomEvent<string>;
    "agent-option": CustomEvent<{ id: string; value: string }>;
    "agent-remove": CustomEvent<void>;
    "agent-accounts": CustomEvent<Accounts>;
  }
}

/** An extra login of the agent: its config folder (CLAUDE_CONFIG_DIR for Claude Code). "" is the CLI's own. */
type Account = { name: string; dir: string };
export type Accounts = { accounts: Account[]; active: string; auto: boolean };

/** One coding agent's settings, in its folded-open row: help, the program, its options and what it can do. */
@customElement("relay-settings-agent")
export class SettingsAgent extends SettingsElement {
  static override styles = [tws];

  @property({ attribute: false }) status!: AgentStatus;
  @property({ attribute: false }) config!: { on: boolean; bin: string; [opt: string]: unknown };
  /** The agent's own package: its help and options */
  @property({ attribute: false }) agent?: AgentProvider;

  private renderCapabilities() {
    const names = ["images", "permissions", "questions", "subagents", "terminal", "limits", "effort"] as const;
    const pills = names
      .filter(name => this.status.caps[name])
      .map(name => html`<span class=${PILL}>${t(`ag.cap.${name}`)}</span>`);
    return field(
      withoutColon(t("ag.caps")),
      html`<span class="flex max-w-2xs flex-wrap justify-end gap-1">${pills}</span>`,
    );
  }

  private renderBin() {
    const { status, config } = this;
    const id = status.id;
    const note = status.detect.note;
    const input = html`<input
      class=${FIELD}
      id="agbin-${id}"
      .value=${live(config.bin)}
      placeholder=${t("ag.binPh", { bin: status.defaultBin })}
      spellcheck="false"
      @change=${(e: Event) => emit(this, "agent-bin", inputValue(e).trim())}
    />`;
    return field(withoutColon(t("ag.bin")), input, { id: `agbin-${id}`, hint: note ? html`<code>${note}</code>` : "" });
  }

  /** The agent's logins: the CLI's own and the extra config folders, which one new conversations use, and
   *  whether to move on when one's limits run out. */
  private renderAccounts() {
    const id = this.status.id;
    const now: Accounts = {
      accounts: (this.config.accounts as Account[] | undefined) ?? [],
      active: (this.config.active as string | undefined) ?? "",
      auto: this.config.auto === true,
    };
    const save = (changes: Partial<Accounts>) => emit(this, "agent-accounts", { ...now, ...changes });
    const add = async () => {
      const dir = await invoke<string | null>("pick_folder");
      if (!dir || now.accounts.some(account => account.dir === dir)) return;
      save({ accounts: [...now.accounts, { name: dir.split("/").pop()!.replace(/^\./, ""), dir }] });
    };
    const rows = now.accounts.map(
      (account, i) =>
        html`<div class="flex items-center justify-end gap-2">
          <input
            class=${FIELD_CHIP}
            aria-label=${t("ag.accountName")}
            .value=${live(account.name)}
            maxlength="40"
            @change=${(e: Event) =>
              save({ accounts: now.accounts.map((a, j) => (j === i ? { ...a, name: inputValue(e).trim() } : a)) })}
          /><code class="max-w-48 truncate text-xs text-s-muted" title=${account.dir}>${account.dir}</code
          ><button
            class=${buttonClass("ghost")}
            @click=${() =>
              save({
                accounts: now.accounts.filter((_, j) => j !== i),
                active: now.active === account.dir ? "" : now.active,
              })}
          >
            ${t("ag.remove")}
          </button>
        </div>`,
    );
    const choices = [{ name: t("ag.accountOwn"), dir: "" }, ...now.accounts].map(
      account => html`<option value=${account.dir} ?selected=${now.active === account.dir}>${account.name}</option>`,
    );
    const select = html`<select
      class=${SELECT}
      id="agact-${id}"
      @change=${(e: Event) => save({ active: inputValue(e) })}
    >
      ${choices}
    </select>`;
    const login = now.accounts.length
      ? html`<code>CLAUDE_CONFIG_DIR=${now.accounts[now.accounts.length - 1].dir} claude /login</code>`
      : "";
    return html`${field(
      t("ag.accounts"),
      html`<div class="flex flex-col items-end gap-1">
        ${rows}
        <button class=${buttonClass("ghost")} @click=${add}>${t("ag.accountAdd")}</button>
      </div>`,
      { hint: html`${t("ag.accountsHelp")} ${login}` },
    )}
    ${
      now.accounts.length
        ? html`${field(t("ag.accountActive"), select, { id: `agact-${id}` })}
          ${field(
            t("ag.accountAuto"),
            toggleSwitch(`agauto-${id}`, now.auto, (e: Event) =>
              save({ auto: (e.target as HTMLInputElement).checked }),
            ),
            {
              id: `agauto-${id}`,
              hint: t("ag.accountAutoHelp"),
            },
          )}`
        : nothing
    }`;
  }

  private renderOption(provider: AgentProvider, option: NonNullable<AgentProvider["options"]>[number]) {
    const id = `agopt-${this.status.id}-${option.id}`;
    const current = this.config[option.id] ?? option.choices[0].id;
    const choices = option.choices.map(
      choice =>
        html`<option value=${choice.id} ?selected=${current === choice.id}>${at(provider, choice.label)}</option>`,
    );
    const select = html`<select
      class=${SELECT}
      id=${id}
      @change=${(e: Event) => emit(this, "agent-option", { id: option.id, value: inputValue(e) })}
    >
      ${choices}
    </select>`;
    return field(at(provider, option.label), select, { id });
  }

  override render() {
    const provider = this.agent;
    return html`${provider ? html`<p class=${HINT_IN_ROW}>${ath(provider, "set.help")}</p>` : nothing}
      ${this.renderBin()} ${(provider?.options ?? []).map(option => this.renderOption(provider!, option))}
      ${this.status.caps.accounts ? this.renderAccounts() : nothing} ${this.renderCapabilities()}
      <div class="mt-0.5 flex flex-wrap items-center gap-2">
        <span class="flex-1"></span
        ><button class=${buttonClass("ghost")} @click=${() => emit(this, "agent-remove")}>${t("ag.remove")}</button>
      </div>`;
  }
}
