import { html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { emit } from "../../core/dom";
import { t, th, tn } from "../../core/i18n";
import { iconFrom, isSite, loadIcons, setIcon, type IconKind, type ProjectIcon } from "../../domain/icons";
import { btn, foot, OPT, projectIcon, sec, SEMPTY, ST } from "./blocks";
import "./settings-fold";
import "./settings-project";
import { SettingsElement } from "./settings-element";
import { page, tws } from "./styles";
import type { SaveSettings, Settings } from "./types";

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
  @property() msg = "";
  @property({ type: Boolean }) ok = false;
  // the project icons: every project, folded, to override
  @state() private icons: Record<string, ProjectIcon> | null = null;
  @state() private iconNames: string[] = [];
  @state() private iconMsg = "";
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
    }).then(f => (this.unlisten = f));
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
    const [i, snap, rp] = await Promise.all([
      loadIcons(),
      invoke<any>("snapshot").catch(() => ({ projects: [] })),
      invoke<Record<string, string[]>>("project_repos").catch(() => ({})),
    ]);
    this.icons = i;
    this.repos = rp;
    this.iconProjects = snap.projects || [];
    this.iconNames = this.iconProjects.map(x => String(x.name)).sort((a, b) => a.localeCompare(b));
  }
  // what the icon is now, under the icon line
  private iconHint(n: string) {
    const i = this.icons?.[n];
    if (!i) return t("pi.guess");
    if (i.img) return t("pi.image");
    if (i.icon) return t("pi.emoji");
    if (isSite(i.value))
      return this.settings.favicons?.tried?.[n] === i.value
        ? t("pi.siteNoIcon", { site: i.value })
        : t("pi.siteSoon", { site: i.value });
    return t("pi.noIcon");
  }
  private async setRepos(project: string, list: string[]) {
    try {
      await invoke("set_project_repos", { project, repos: list });
      this.iconMsg = "";
      this.iconOk = true;
      this.repos = await invoke<Record<string, string[]>>("project_repos");
    } catch (x) {
      this.iconMsg = String(x);
      this.iconOk = false;
    }
  }
  // Find icons: Claude looks up the website of every project without an icon (or set to none), its favicon follows
  private async findIcons() {
    const targets = this.iconProjects.filter(p => {
      const i = this.icons?.[p.name];
      return !i || i.value === "";
    });
    if (!targets.length) {
      this.iconMsg = t("pi.findNone");
      this.iconOk = true;
      return;
    }
    this.finding = true;
    this.iconMsg = "";
    try {
      const found = await invoke<Record<string, string>>("find_icon_sites", {
        projects: targets.map(p => ({ name: p.name, context: p.context ?? "", summary: p.summary ?? "" })),
      });
      for (const [n, site] of Object.entries(found)) await setIcon(n, "site", site);
      const n = Object.keys(found).length;
      this.iconMsg = n ? t("pi.found", { n, total: targets.length }) : t("pi.findNone");
      this.iconOk = true;
    } catch (x) {
      this.iconMsg = String(x);
      this.iconOk = false;
    }
    this.finding = false;
  }
  // the backend emits icons-changed, which reloads the pane
  private async iconSet(project: string, kind: IconKind, value = "") {
    try {
      await setIcon(project, kind, value);
      this.iconMsg = "";
      this.iconOk = true;
    } catch (x) {
      this.iconMsg = String(x);
      this.iconOk = false;
    }
  }
  private async iconFile(project: string, f: File) {
    const u = await iconFrom(f);
    if (u) await this.iconSet(project, "img", u);
    else {
      this.iconMsg = t("img.unreadable");
      this.iconOk = false;
    }
  }
  private label(n: string, l: string) {
    const next = structuredClone(this.settings);
    if (l) next.projects[n] = { ...next.projects[n], label: l };
    else delete next.projects[n];
    emit(this, "save-settings", { settings: next, done: "" });
  }
  private toggle(key: string) {
    const o = new Set(this.opened);
    if (!o.delete(key)) o.add(key);
    this.opened = o;
  }

  private row(n: string) {
    const { icons, settings, repos } = this,
      i = icons![n];
    const l = settings.projects[n]?.label,
      ctx = this.iconProjects.find(p => p.name === n)?.context ?? "";
    // one input for an emoji or a website; the buttons for an image, none and guessing again
    const v = i?.icon ?? (i && isSite(i.value) ? i.value : "");
    return html`<relay-settings-fold
      ?open=${this.opened.has(n)}
      @fold-toggle=${() => this.toggle(n)}
      .ico=${projectIcon(i, "row")}
      .name=${l ? html`${l} <span class="${OPT} ml-1 font-normal">${n}</span>` : n}
      .state=${html`<span class=${ST}>${[ctx, repos[n]?.length ? tn("pc.repoCount", repos[n].length) : ""].filter(Boolean).join(" · ")}</span>`}
    >
      ${
        this.opened.has(n)
          ? html`<relay-settings-project
              .name=${n}
              .label=${l ?? ""}
              .icon=${i}
              .iconText=${v}
              .iconHint=${this.iconHint(n)}
              .repos=${repos[n] ?? []}
              @label-change=${(e: CustomEvent<string>) => this.label(n, e.detail)}
              @icon-text=${(e: CustomEvent<string>) => this.iconSet(n, !e.detail ? "reset" : isSite(e.detail) ? "site" : "emoji", e.detail)}
              @icon-file=${(e: CustomEvent<File>) => this.iconFile(n, e.detail)}
              @icon-none=${() => this.iconSet(n, "none")}
              @icon-reset=${() => this.iconSet(n, "reset")}
              @repos-change=${(e: CustomEvent<string[]>) => this.setRepos(n, e.detail)}
            ></relay-settings-project>`
          : nothing
      }
    </relay-settings-fold>`;
  }

  override render() {
    if (!this.icons)
      return sec(t("set.tab.projects"), html`<div class=${ST}><span class="spinner"></span>${t("pr.loading")}</div>`);
    const m = this.iconMsg || this.msg;
    return sec(
      t("set.tab.projects"),
      this.iconNames.length ? this.iconNames.map(n => this.row(n)) : html`<div class=${SEMPTY}>${t("set.none")}</div>`,
      {
        desc: th("pc.desc"),
        list: true,
        foot: m ? foot(m, this.iconMsg ? this.iconOk : this.ok, nothing) : nothing,
        action: html`<button
          class=${btn()}
          @click=${() => this.findIcons()}
          title=${t("pi.findHelp")}
          ?disabled=${this.finding}
        >
          ${this.finding ? html`<span class="spinner"></span> ${t("pi.finding")}` : t("pi.find")}
        </button>`,
      },
    );
  }
}
