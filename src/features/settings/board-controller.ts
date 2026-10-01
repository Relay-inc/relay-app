import { invoke } from "@tauri-apps/api/core";
import { t } from "../../core/i18n";
import { ctxOf, PROVIDERS, type BoardOpt, type BoardProvider } from "../../domain/providers";
import type { IntHost } from "./mail-controller";
import type { Msg, Settings } from "./types";

/** The board providers' state and calls, kept by the integrations page so they survive the row folding shut. */
export class BoardsController {
  // the token sits in the macOS keychain, the backend only says whether there is one
  tokens: Record<string, boolean> = {};
  msgs: Record<string, Msg> = {};
  // the boards per vault project, for a provider that lists all its boards in one call: loaded once the pane shows set up
  all: Record<string, { list: BoardOpt[] | null; err: string }> = {};
  vaultProjects: string[] | null = null;
  // per board provider: can it take its credentials from Claude Code, and does Claude Code have them (asked once)
  mcp: Record<string, { supported: boolean; found: boolean }> = {};
  private mcpAsked = false;
  constructor(private h: IntHost, private form: Record<string, string | boolean>) {}

  private up() { this.h.requestUpdate(); }
  async loadTokens() {
    this.tokens = Object.fromEntries(await Promise.all(PROVIDERS.map(async p =>
      [p.id, await invoke<boolean>("integration_has_token", { provider: p.id }).catch(() => false)] as const)));
  }
  askMcp() {
    if (this.mcpAsked) return; this.mcpAsked = true;
    Promise.all(PROVIDERS.map(async p => { this.mcp[p.id] = await invoke<{ supported: boolean; found: boolean }>("integration_mcp", { provider: p.id }).catch(() => ({ supported: false, found: false })); })).then(() => this.up());
  }
  // set up: every secret in the keychain and every field that is not optional
  setUp = (p: BoardProvider) => this.tokens[p.id] && p.settings.fields.every(f => f.optional || f.secret || this.h.settings.integrations[p.id]?.[f.key]);

  async load(p: BoardProvider) {
    this.all[p.id] = { list: null, err: "" };
    try {
      const [list, snap] = await Promise.all([p.settings.allBoards!(ctxOf(p, this.h.settings.integrations)), this.vaultProjects ?? invoke<any>("snapshot")]);
      this.vaultProjects ??= (snap.projects || []).map((x: any) => String(x.name)).sort((a: string, b: string) => a.localeCompare(b));
      this.all[p.id] = { list, err: "" };
    } catch (e) { this.all[p.id] = { list: [], err: String(e) }; }
    this.up();
  }
  async map(p: BoardProvider, vp: string, value: string) {
    // a vault project has at most one board: picking one replaces what it had, None only drops this provider's
    const boards = { ...this.h.settings.boards }, [project, board] = value.split("/");
    if (board) boards[vp] = { provider: p.id, project, board }; else if (boards[vp]?.provider === p.id) delete boards[vp]; else return;
    try { this.h.commit(await invoke<Settings>("set_settings", { settings: { ...this.h.settings, boards } })); this.msgs[p.id] = { text: t("set.saved"), ok: true }; }
    catch (x) { this.msgs[p.id] = { text: String(x), ok: false }; }
    this.up();
  }

  async saveForm(p: BoardProvider) {
    const cfg: Record<string, any> = { ...this.h.settings.integrations[p.id], on: true };
    const secrets: Record<string, string> = { token: this.str(`tok-${p.id}`).trim() };
    for (const f of p.settings.fields) {
      const fid = `f-${p.id}-${f.key}`;
      if (f.check) cfg[f.key] = !!(this.form[fid] ?? cfg[f.key]);
      else if (f.secret) secrets[f.key] = this.str(fid).trim();
      else cfg[f.key] = this.str(fid, cfg[f.key]).trim();
    }
    this.msgs[p.id] = { text: t("int.busy"), ok: true }; this.up();
    await this.save(p, cfg, secrets);
    // the form shows what is stored now: the secrets are cleared, the rest follows the saved config
    for (const k of Object.keys(this.form)) if (k === `tok-${p.id}` || k.startsWith(`f-${p.id}-`)) delete this.form[k];
    this.up();
  }
  private str(id: string, d: unknown = "") { const v = this.form[id]; return typeof v === "string" ? v : String(d ?? ""); }
  // saves the token and the config, then one call to the provider to show they work together
  private async save(p: BoardProvider, cfg: Record<string, any>, secrets: Record<string, string> = {}) {
    try {
      for (const [account, token] of Object.entries(secrets)) if (token) await invoke("integration_token", { provider: p.id, token, account });
      this.tokens[p.id] = await invoke<boolean>("integration_has_token", { provider: p.id });
      this.h.commit(await invoke<Settings>("set_settings", { settings: { ...this.h.settings, integrations: { ...this.h.settings.integrations, [p.id]: cfg } } }));
      this.msgs[p.id] = { text: await p.settings.test(ctxOf(p, this.h.settings.integrations)), ok: true };
      delete this.all[p.id];
    } catch (e) { this.msgs[p.id] = { text: String(e), ok: false }; }
    this.up();
  }
  async import(p: BoardProvider) {
    try { const r = await invoke<Record<string, string>>("integration_import", { provider: p.id }); await this.save(p, { ...this.h.settings.integrations[p.id], ...r }); }
    catch (e) { this.msgs[p.id] = { text: String(e), ok: false }; this.up(); }
  }
  async clear(p: BoardProvider) {
    await invoke("integration_token", { provider: p.id, token: "" }); this.tokens[p.id] = false; delete this.all[p.id]; this.msgs[p.id] = { text: t("int.cleared"), ok: true }; this.up();
  }
}
