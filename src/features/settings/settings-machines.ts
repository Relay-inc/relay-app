import { html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { emit } from "../../core/dom";
import { t, th } from "../../core/i18n";
import {
  buttonClass,
  EMPTY_LIST,
  ERROR_MESSAGE,
  field,
  FIELD,
  HINT,
  HINT_IN_ROW,
  inputValue,
  PILL,
  section,
  SELECT,
  statusLine,
} from "./blocks";
import { SettingsElement } from "./settings-element";
import { page, tws } from "./styles";
import type { Machine, Settings } from "./types";
import type { Snapshot } from "../../domain/vault";

declare global {
  interface HTMLElementTagNameMap {
    "relay-settings-machines": SettingsMachines;
  }
}

type Status = { ok: boolean; host?: string; version?: string; os?: string; error?: string };
type Row = { project: string; path: string };

/** Machines: other computers in the LAN running relay-server. Pairing, the online check and the project folders on
 *  each machine. The backend saves machines itself and emits settings-changed, which this page passes up. */
@customElement("relay-settings-machines")
export class SettingsMachines extends SettingsElement {
  static override styles = [tws, page];

  @property({ type: Boolean, reflect: true }) active = false;
  @property({ attribute: false }) settings!: Settings;
  @state() private line = "";
  @state() private name = "";
  @state() private pairing = false;
  @state() private pairError = "";
  @state() private status: Record<string, Status | "checking"> = {};
  @state() private projects: string[] = [];
  // folder rows being edited per machine, until Save
  @state() private drafts: Record<string, Row[]> = {};
  @state() private errors: Record<string, string> = {};
  @state() private saved = new Set<string>();
  @state() private forgetting = "";
  private checked = false;
  private unlisten?: () => void;

  override connectedCallback() {
    super.connectedCallback();
    listen<Settings>("settings-changed", e => emit(this, "settings-changed", e.payload)).then(
      unlisten => (this.unlisten = unlisten),
    );
  }
  override disconnectedCallback() {
    super.disconnectedCallback();
    this.unlisten?.();
  }
  override willUpdate() {
    if (this.active && !this.checked) {
      this.checked = true;
      this.loadProjects();
      this.checkAll();
    }
  }

  private machines = () => this.settings.machines ?? [];

  private async loadProjects() {
    const snapshot = await invoke<Snapshot>("snapshot").catch((): Pick<Snapshot, "projects"> => ({ projects: [] }));
    this.projects = (snapshot.projects || []).map(project => String(project.name)).sort((a, b) => a.localeCompare(b));
  }
  private async check(id: string) {
    this.status = { ...this.status, [id]: "checking" };
    const result = await invoke<Status>("machine_status", { id }).catch((error): Status => ({
      ok: false,
      error: String(error),
    }));
    this.status = { ...this.status, [id]: result };
  }
  private checkAll() {
    this.machines().forEach(machine => this.check(machine.id));
  }

  private async pair() {
    this.pairing = true;
    this.pairError = "";
    try {
      const machine = await invoke<Machine>("machine_pair", { line: this.line.trim(), name: this.name.trim() });
      this.line = "";
      this.name = "";
      this.check(machine.id);
    } catch (error) {
      this.pairError = String(error);
    }
    this.pairing = false;
  }
  private async forget(id: string) {
    this.forgetting = "";
    try {
      await invoke("machine_forget", { id });
    } catch (error) {
      this.errors = { ...this.errors, [id]: String(error) };
    }
  }

  // folder rows: the draft, else what is saved
  private rows(machine: Machine): Row[] {
    return (
      this.drafts[machine.id] ?? Object.entries(machine.folders ?? {}).map(([project, path]) => ({ project, path }))
    );
  }
  private editRows(machine: Machine, change: (rows: Row[]) => void) {
    const rows = this.rows(machine).map(row => ({ ...row }));
    change(rows);
    this.drafts = { ...this.drafts, [machine.id]: rows };
    this.saved.delete(machine.id);
    this.errors = { ...this.errors, [machine.id]: "" };
  }
  private async saveFolders(machine: Machine) {
    const rows = this.rows(machine).filter(row => row.project || row.path.trim());
    const folders: Record<string, string> = {};
    for (const { project, path } of rows) {
      if (!project || !path.trim().startsWith("/")) {
        this.errors = { ...this.errors, [machine.id]: t("mc.errPath") };
        return;
      }
      folders[project] = path.trim();
    }
    try {
      await invoke("set_machine_folders", { id: machine.id, folders });
      const { [machine.id]: _gone, ...rest } = this.drafts;
      this.drafts = rest;
      this.errors = { ...this.errors, [machine.id]: "" };
      this.saved = new Set(this.saved).add(machine.id);
    } catch (error) {
      this.errors = { ...this.errors, [machine.id]: String(error) };
    }
  }

  private renderStatus(machine: Machine) {
    const status = this.status[machine.id];
    if (!status || status === "checking") return statusLine("off", t("mc.checking"));
    if (!status.ok) return statusLine("warn", t("mc.offline"));
    return statusLine("ok", [t("mc.online"), status.version, status.os].filter(Boolean).join(" · "));
  }

  private renderFolderRow(machine: Machine, row: Row, index: number) {
    // a project already linked elsewhere in this list is not offered twice
    const taken = new Set(this.rows(machine).map(other => other.project));
    const options = this.projects.filter(name => name === row.project || !taken.has(name));
    return html`<div class="flex items-center gap-2">
      <select
        class=${SELECT}
        aria-label=${t("mc.project")}
        @change=${(e: Event) => this.editRows(machine, rows => (rows[index].project = inputValue(e)))}
      >
        <option value="" ?selected=${!row.project}>${t("mc.pickProject")}</option>
        ${options.map(name => html`<option value=${name} ?selected=${name === row.project}>${name}</option>`)}
      </select>
      <input
        class="${FIELD} min-w-0 flex-1 font-mono"
        placeholder="/home/laurent/projects/…"
        aria-label=${t("mc.path")}
        .value=${row.path}
        @input=${(e: Event) => this.editRows(machine, rows => (rows[index].path = inputValue(e)))}
      />
      <button class=${buttonClass("ghost")} @click=${() => this.editRows(machine, rows => rows.splice(index, 1))}>
        ${t("mc.removeFolder")}
      </button>
    </div>`;
  }

  private renderMachine(machine: Machine) {
    const error = this.errors[machine.id];
    const confirming = this.forgetting === machine.id;
    const forgetButtons = confirming
      ? html`<span class="text-xs text-s-muted">${t("mc.forgetSure")}</span>
          <button class=${buttonClass("plain")} @click=${() => this.forget(machine.id)}>${t("mc.forget")}</button>
          <button class=${buttonClass("ghost")} @click=${() => (this.forgetting = "")}>${t("mc.cancel")}</button>`
      : html`<button class=${buttonClass("ghost")} @click=${() => (this.forgetting = machine.id)}>
          ${t("mc.forget")}
        </button>`;
    return html`<div class="grid gap-2.5 border-b border-s-border px-3.5 py-3 last:border-b-0">
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span class="text-[13px] font-semibold text-s-fg">${machine.name}</span>
        <span class="font-mono text-xs text-s-muted">${machine.host}:${machine.port}</span>
        ${this.renderStatus(machine)}
        <span class="${PILL} font-mono" title=${t("mc.fingerprint")}>${(machine.fp ?? "").slice(0, 16)}</span>
        <span class="flex-1"></span>
        ${forgetButtons}
      </div>
      ${confirming ? html`<p class=${HINT_IN_ROW}>${th("mc.forgetHelp", { name: machine.name })}</p>` : nothing}
      <div class="grid gap-1.5">
        <span class="text-xs font-medium text-s-fg">${t("mc.folders")}</span>
        ${
          this.rows(machine).length
            ? this.rows(machine).map((row, index) => this.renderFolderRow(machine, row, index))
            : html`<p class=${HINT_IN_ROW}>${t("mc.noFolders")}</p>`
        }
        <div class="flex flex-wrap items-center gap-2">
          <button
            class=${buttonClass("ghost")}
            @click=${() => this.editRows(machine, rows => rows.push({ project: "", path: "" }))}
          >
            ${t("mc.addFolder")}
          </button>
          <button class=${buttonClass("primary")} @click=${() => this.saveFolders(machine)}>${t("mc.save")}</button>
          ${error ? html`<span class=${ERROR_MESSAGE}>${error}</span>` : nothing}
          ${this.saved.has(machine.id) ? html`<span class="text-xs text-s-muted">${t("set.saved")}</span>` : nothing}
        </div>
      </div>
    </div>`;
  }

  private renderPair() {
    const button = html`<button
      class=${buttonClass("primary")}
      ?disabled=${this.pairing || !this.line.trim()}
      @click=${() => this.pair()}
    >
      ${this.pairing ? t("mc.pairing") : t("mc.pair")}
    </button>`;
    return section(
      t("mc.pairTitle"),
      html`${field(
          t("mc.line"),
          html`<input
            class=${FIELD}
            placeholder="relay://192.168.1.2:47800#fp=…&code=…"
            spellcheck="false"
            .value=${this.line}
            @input=${(e: Event) => (this.line = inputValue(e))}
          />`,
          { hint: th("mc.lineHelp") },
        )}
        ${field(
          t("mc.name"),
          html`<input
            class=${FIELD}
            placeholder=${t("mc.namePh")}
            .value=${this.name}
            @input=${(e: Event) => (this.name = inputValue(e))}
          />`,
        )}
        <div class="flex flex-wrap items-center gap-2">
          ${this.pairError ? html`<span class=${ERROR_MESSAGE}>${this.pairError}</span>` : nothing}
          <span class="flex-1"></span>${button}
        </div>`,
    );
  }

  override render() {
    const machines = this.machines();
    const refresh = html`<button class=${buttonClass("ghost")} @click=${() => this.checkAll()}>
      ${t("mc.refresh")}
    </button>`;
    return html`<p class=${HINT}>${th("mc.intro")}</p>
      ${this.renderPair()}
      ${section(
        t("set.tab.machines"),
        machines.length
          ? machines.map(machine => this.renderMachine(machine))
          : html`<div class=${EMPTY_LIST}>${t("mc.empty")}</div>`,
        { list: true, action: refresh },
      )}`;
  }
}
