import { invoke } from "@tauri-apps/api/core";
import { t } from "../../core/i18n";
import { ctxOf, PROVIDERS, type BoardOpt, type BoardProvider } from "../../domain/providers";
import { formText } from "./blocks";
import type { IntegrationsHost } from "./mail-controller";
import type { Message, Settings } from "./types";
import type { IntegrationConfig } from "../../domain/config";
import type { Snapshot } from "../../domain/vault";

type McpStatus = { supported: boolean; found: boolean };

/** The vault's project names, sorted, for mapping boards to them. */
async function loadVaultProjects() {
  const snapshot = await invoke<Snapshot>("snapshot");
  return snapshot.projects.map(project => project.name).sort((a, b) => a.localeCompare(b));
}

/** The board providers' state and calls, kept by the integrations page so they survive the row folding shut. */
export class BoardsController {
  // the token sits in the macOS keychain, the backend only says whether there is one
  tokens: Record<string, boolean> = {};
  messages: Record<string, Message> = {};
  // the boards per vault project, for a provider that lists all its boards in one call: loaded once the pane shows set up
  all: Record<string, { list: BoardOpt[] | null; err: string }> = {};
  vaultProjects: string[] | null = null;
  // per board provider: can it take its credentials from Claude Code, and does Claude Code have them (asked once)
  mcp: Record<string, McpStatus> = {};
  private mcpAsked = false;
  constructor(
    private host: IntegrationsHost,
    private form: Record<string, string | boolean>,
  ) {}

  private redraw() {
    this.host.requestUpdate();
  }

  async loadTokens() {
    const entries = await Promise.all(
      PROVIDERS.map(async provider => {
        const hasToken = await invoke<boolean>("integration_has_token", { provider: provider.id }).catch(() => false);
        return [provider.id, hasToken] as const;
      }),
    );
    this.tokens = Object.fromEntries(entries);
  }

  askMcp() {
    if (this.mcpAsked) return;
    this.mcpAsked = true;
    const asks = PROVIDERS.map(async provider => {
      this.mcp[provider.id] = await invoke<McpStatus>("integration_mcp", { provider: provider.id }).catch(() => ({
        supported: false,
        found: false,
      }));
    });
    Promise.all(asks).then(() => this.redraw());
  }

  // set up: every secret in the keychain and every field that is not optional
  setUp = (provider: BoardProvider) =>
    this.tokens[provider.id] &&
    provider.settings.fields.every(
      field => field.optional || field.secret || this.host.settings.integrations[provider.id]?.[field.key],
    );

  async load(provider: BoardProvider) {
    this.all[provider.id] = { list: null, err: "" };
    try {
      const [list, names] = await Promise.all([
        provider.settings.allBoards!(ctxOf(provider, this.host.settings.integrations)),
        this.vaultProjects ?? loadVaultProjects(),
      ]);
      this.vaultProjects = names;
      this.all[provider.id] = { list, err: "" };
    } catch (error) {
      this.all[provider.id] = { list: [], err: String(error) };
    }
    this.redraw();
  }

  async map(provider: BoardProvider, vaultProject: string, value: string) {
    // a vault project has at most one board: picking one replaces what it had, None only drops this provider's
    const boards = { ...this.host.settings.boards };
    const [project, board] = value.split("/");
    if (board) boards[vaultProject] = { provider: provider.id, project, board };
    else if (boards[vaultProject]?.provider === provider.id) delete boards[vaultProject];
    else return;
    try {
      const saved = await invoke<Settings>("set_settings", { settings: { ...this.host.settings, boards } });
      this.host.commit(saved);
      this.messages[provider.id] = { text: t("set.saved"), ok: true };
    } catch (error) {
      this.messages[provider.id] = { text: String(error), ok: false };
    }
    this.redraw();
  }

  // what the form holds for this provider, as the config to save and the secrets to put in the keychain
  private readForm(provider: BoardProvider) {
    const config: IntegrationConfig = { ...this.host.settings.integrations[provider.id], on: true };
    const secrets: Record<string, string> = { token: formText(this.form, `tok-${provider.id}`).trim() };
    for (const field of provider.settings.fields) {
      const id = `f-${provider.id}-${field.key}`;
      if (field.check) config[field.key] = !!(this.form[id] ?? config[field.key]);
      else if (field.secret) secrets[field.key] = formText(this.form, id).trim();
      else config[field.key] = formText(this.form, id, config[field.key]).trim();
    }
    return { config, secrets };
  }

  async saveForm(provider: BoardProvider) {
    const { config, secrets } = this.readForm(provider);
    this.messages[provider.id] = { text: t("int.busy"), ok: true };
    this.redraw();
    await this.save(provider, config, secrets);
    // the form shows what is stored now: the secrets are cleared, the rest follows the saved config
    for (const id of Object.keys(this.form)) {
      if (id === `tok-${provider.id}` || id.startsWith(`f-${provider.id}-`)) delete this.form[id];
    }
    this.redraw();
  }

  // saves the token and the config, then one call to the provider to show they work together
  private async save(provider: BoardProvider, config: IntegrationConfig, secrets: Record<string, string> = {}) {
    try {
      for (const [account, token] of Object.entries(secrets)) {
        if (token) await invoke("integration_token", { provider: provider.id, token, account });
      }
      this.tokens[provider.id] = await invoke<boolean>("integration_has_token", { provider: provider.id });
      const integrations = { ...this.host.settings.integrations, [provider.id]: config };
      this.host.commit(await invoke<Settings>("set_settings", { settings: { ...this.host.settings, integrations } }));
      const test = await provider.settings.test(ctxOf(provider, this.host.settings.integrations));
      this.messages[provider.id] = { text: test, ok: true };
      delete this.all[provider.id];
    } catch (error) {
      this.messages[provider.id] = { text: String(error), ok: false };
    }
    this.redraw();
  }

  async import(provider: BoardProvider) {
    try {
      const imported = await invoke<Record<string, string>>("integration_import", { provider: provider.id });
      await this.save(provider, { ...this.host.settings.integrations[provider.id], ...imported });
    } catch (error) {
      this.messages[provider.id] = { text: String(error), ok: false };
      this.redraw();
    }
  }

  async clear(provider: BoardProvider) {
    await invoke("integration_token", { provider: provider.id, token: "" });
    this.tokens[provider.id] = false;
    delete this.all[provider.id];
    this.messages[provider.id] = { text: t("int.cleared"), ok: true };
    this.redraw();
  }
}
