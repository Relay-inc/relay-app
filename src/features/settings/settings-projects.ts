import { html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { emit } from "../../core/dom";
import { t, th, tn } from "../../core/i18n";
import { iconFrom, isSite, loadIcons, setIcon, type IconKind, type ProjectIcon } from "../../domain/icons";
import { buttonClass, footer, OPTIONAL_TEXT, projectIcon, section, EMPTY_LIST, STATUS_TEXT } from "./blocks";
import "./settings-fold";
import "./settings-project";
import { SettingsElement } from "./settings-element";
import { page, tws } from "./styles";
import type { SaveSettings, Settings } from "./types";
import type { Snapshot } from "../../domain/vault";

declare global {
  interface HTMLElementTagNameMap {
    "relay-settings-projects": SettingsProjects;
  }
  interface HTMLElementEventMap {
    "save-settings": CustomEvent<SaveSettings>;
  }
}

/** Projects: every project, a row folds open to its configuration. The name in Relay stays in the app's settings; the
 *  icon and the repos live in the vault's .relay/config.json (src/domain/icons.ts). */
@customElement("relay-settings-projects")
export class SettingsProjects extends SettingsElement {
  static override styles = [tws, page];

  @property({ type: Boolean, reflect: true }) active = false;
  @property({ attribute: false }) settings!: Settings;
  /** The result of the container's last save (a project's name) */
  @property() message = "";
  @property({ type: Boolean }) ok = false;
  // the project icons: every project, folded, to override
  @state() private icons: Record<string, ProjectIcon> | null = null;
  @state() private iconNames: string[] = [];
  @state() private iconMessage = "";
  @state() private iconOk = false;
  @state() private finding = false;
  @state() private repos: Record<string, string[]> = {};
  @state() private iconProjects: { name: string; context?: string; summary?: string }[] = [];
  @state() private opened = new Set<string>();
  private loading = false;
  private unlisten?: () => void;

  override connectedCallback() {
    super.connectedCallback();
    listen("icons-changed", () => {
      if (this.icons) this.load();
    }).then(unlisten => (this.unlisten = unlisten));
  }
  override disconnectedCallback() {
    super.disconnectedCallback();
    this.unlisten?.();
  }
  override willUpdate() {
    if (this.active && !this.icons && !this.loading) {
      this.loading = true;
      this.load();
    }
  }

  private async load() {
    const [icons, snapshot, repos] = await Promise.all([
      loadIcons(),
      invoke<Snapshot>("snapshot").catch((): Pick<Snapshot, "projects"> => ({ projects: [] })),
      invoke<Record<string, string[]>>("project_repos").catch(() => ({})),
    ]);
    this.icons = icons;
    this.repos = repos;
    this.iconProjects = snapshot.projects || [];
    this.iconNames = this.iconProjects.map(project => String(project.name)).sort((a, b) => a.localeCompare(b));
  }

  // what the icon is now, under the icon line
  private iconHint(project: string) {
    const icon = this.icons?.[project];
    if (!icon) return t("pi.guess");
    if (icon.img) return t("pi.image");
    if (icon.icon) return t("pi.emoji");
    if (!isSite(icon.value)) return t("pi.noIcon");
    const faviconTried = this.settings.favicons?.tried?.[project] === icon.value;
    return faviconTried ? t("pi.siteNoIcon", { site: icon.value }) : t("pi.siteSoon", { site: icon.value });
  }

  private async setRepos(project: string, repos: string[]) {
    try {
      await invoke("set_project_repos", { project, repos });
      this.iconMessage = "";
      this.iconOk = true;
      this.repos = await invoke<Record<string, string[]>>("project_repos");
    } catch (error) {
      this.iconMessage = String(error);
      this.iconOk = false;
    }
  }

  // Find icons: Claude looks up the website of every project without an icon (or set to none), its favicon follows
  private async findIcons() {
    const targets = this.iconProjects.filter(project => {
      const icon = this.icons?.[project.name];
      return !icon || icon.value === "";
    });
    if (!targets.length) {
      this.iconMessage = t("pi.findNone");
      this.iconOk = true;
      return;
    }
    this.finding = true;
    this.iconMessage = "";
    try {
      const sites = await invoke<Record<string, string>>("find_icon_sites", {
        projects: targets.map(project => ({
          name: project.name,
          context: project.context ?? "",
          summary: project.summary ?? "",
        })),
      });
      for (const [name, site] of Object.entries(sites)) await setIcon(name, "site", site);
      const found = Object.keys(sites).length;
      this.iconMessage = found ? t("pi.found", { n: found, total: targets.length }) : t("pi.findNone");
      this.iconOk = true;
    } catch (error) {
      this.iconMessage = String(error);
      this.iconOk = false;
    }
    this.finding = false;
  }

  // the backend emits icons-changed, which reloads the pane
  private async setProjectIcon(project: string, kind: IconKind, value = "") {
    try {
      await setIcon(project, kind, value);
      this.iconMessage = "";
      this.iconOk = true;
    } catch (error) {
      this.iconMessage = String(error);
      this.iconOk = false;
    }
  }

  private async setIconFromFile(project: string, file: File) {
    const dataUrl = await iconFrom(file);
    if (dataUrl) {
      await this.setProjectIcon(project, "img", dataUrl);
      return;
    }
    this.iconMessage = t("img.unreadable");
    this.iconOk = false;
  }

  private setLabel(project: string, label: string) {
    const next = structuredClone(this.settings);
    if (label) next.projects[project] = { ...next.projects[project], label };
    else delete next.projects[project];
    emit(this, "save-settings", { settings: next, done: "" });
  }

  private toggle(project: string) {
    const opened = new Set(this.opened);
    if (!opened.delete(project)) opened.add(project);
    this.opened = opened;
  }

  // what the single icon input does with what was typed: nothing is reset, a website is a site, else an emoji
  private onIconText(project: string, text: string) {
    if (!text) return this.setProjectIcon(project, "reset", text);
    return this.setProjectIcon(project, isSite(text) ? "site" : "emoji", text);
  }

  private renderProjectBody(name: string, icon: ProjectIcon | undefined) {
    const label = this.settings.projects[name]?.label;
    // one input for an emoji or a website; the buttons for an image, none and guessing again
    const iconText = icon?.icon ?? (icon && isSite(icon.value) ? icon.value : "");
    return html`<relay-settings-project
      .name=${name}
      .label=${label ?? ""}
      .icon=${icon}
      .iconText=${iconText}
      .iconHint=${this.iconHint(name)}
      .repos=${this.repos[name] ?? []}
      @label-change=${(e: CustomEvent<string>) => this.setLabel(name, e.detail)}
      @icon-text=${(e: CustomEvent<string>) => this.onIconText(name, e.detail)}
      @icon-file=${(e: CustomEvent<File>) => this.setIconFromFile(name, e.detail)}
      @icon-none=${() => this.setProjectIcon(name, "none")}
      @icon-reset=${() => this.setProjectIcon(name, "reset")}
      @repos-change=${(e: CustomEvent<string[]>) => this.setRepos(name, e.detail)}
    ></relay-settings-project>`;
  }

  // the context of the project and how many repos it has
  private renderSummary(name: string) {
    const context = this.iconProjects.find(project => project.name === name)?.context ?? "";
    const repoCount = this.repos[name]?.length;
    const parts = [context, repoCount ? tn("pc.repoCount", repoCount) : ""].filter(Boolean);
    return html`<span class=${STATUS_TEXT}>${parts.join(" · ")}</span>`;
  }

  private renderRow(name: string) {
    const icon = this.icons![name];
    const label = this.settings.projects[name]?.label;
    const displayName = label ? html`${label} <span class="${OPTIONAL_TEXT} ml-1 font-normal">${name}</span>` : name;
    const open = this.opened.has(name);
    return html`<relay-settings-fold
      ?open=${open}
      @fold-toggle=${() => this.toggle(name)}
      .icon=${projectIcon(icon, "row")}
      .name=${displayName}
      .status=${this.renderSummary(name)}
    >
      ${open ? this.renderProjectBody(name, icon) : nothing}
    </relay-settings-fold>`;
  }

  private renderFindButton() {
    return html`<button
      class=${buttonClass()}
      @click=${() => this.findIcons()}
      title=${t("pi.findHelp")}
      ?disabled=${this.finding}
    >
      ${this.finding ? html`<span class="spinner"></span> ${t("pi.finding")}` : t("pi.find")}
    </button>`;
  }

  override render() {
    if (!this.icons)
      return section(
        t("set.tab.projects"),
        html`<div class=${STATUS_TEXT}><span class="spinner"></span>${t("pr.loading")}</div>`,
      );
    const message = this.iconMessage || this.message;
    const rows = this.iconNames.length
      ? this.iconNames.map(name => this.renderRow(name))
      : html`<div class=${EMPTY_LIST}>${t("set.none")}</div>`;
    return section(t("set.tab.projects"), rows, {
      desc: th("pc.desc"),
      list: true,
      footer: message ? footer(message, this.iconMessage ? this.iconOk : this.ok, nothing) : nothing,
      action: this.renderFindButton(),
    });
  }
}
