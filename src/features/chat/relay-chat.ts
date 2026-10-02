import { LitElement, html, css, nothing } from "lit";
import { customElement, query } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import { t, th } from "../../core/i18n";
import { StoreController, ui as bus } from "../../core/store";
import { tw } from "../../core/styles";
import { ui, WAIT, REM, PRS, MAIL, USAGE, isView, isTerminal, boardOf, boardKey } from "../../domain/ui";
import { chat, terminalOf, projectOf, label, aboutProject, waitCount } from "../../domain/chats/state";
import { rename, openTerminal, moveTo } from "../../domain/chats/actions";
import { invoke } from "@tauri-apps/api/core";
import { openProjectPanel, openTool, closeTool, toggleDrawer } from "../../domain/navigation";
import { agentOf, chatAgent } from "../../domain/agents";
import { prs, loadPrs, projectRepos } from "../../domain/prs";
import { config, ghOn } from "../../domain/config";
import { provider } from "../../domain/providers";
import { vault, projectLabel } from "../../domain/vault";
import { contextTint } from "../../domain/sidebar";
import "./chat-bar";
import "./project-panel";
import "../board/relay-board";
import "../pull-requests/relay-prs";
import "../usage/relay-usage";
import "../mail/relay-mail";
import { openReminderForm } from "../reminders/relay-reminders";
import "../waiting/relay-waiting";
import "../conversation/relay-conversation";
import "../composer/relay-composer";
import "../subagents/relay-subagents";
import type { RelayComposer } from "../composer/relay-composer";

// the strips under the log line up with the messages: the same column, its padding as the gutter
const column = "block w-full max-w-170 mx-auto px-8";
// a card over the bar's width: toast and move bar share the log's column
const strip = "flex items-center gap-2 px-3 py-2 rounded-lg text-sm";

/** The centre column: the title bar, the open conversation or view, the agents it spawned, the composer. */
@customElement("relay-chat")
export class RelayChat extends LitElement {
  static override styles = [
    tw,
    css`
      :host {
        display: flex;
        flex-direction: column;
        min-width: 0;
        min-height: 0;
        position: relative;
        background: var(--bg);
      }
    `,
  ];
  protected store = new StoreController(this);
  // stay at the bottom while it grows: true when the log was within 80 px of the bottom, followed by every resize of its content
  private stick = true;
  private resizeObserver?: ResizeObserver;
  @query("#log") private log!: HTMLElement;
  @query("relay-composer") private composer!: RelayComposer | null;
  @query("#msgs") private msgs!: HTMLElement;

  override connectedCallback() {
    super.connectedCallback();
    bus.addEventListener("focus-composer", this.onFocus);
    bus.addEventListener("scroll-bottom", this.onBottom);
    bus.addEventListener("scroll-top", this.onTop);
  }
  override disconnectedCallback() {
    super.disconnectedCallback();
    bus.removeEventListener("focus-composer", this.onFocus);
    bus.removeEventListener("scroll-bottom", this.onBottom);
    bus.removeEventListener("scroll-top", this.onTop);
    this.resizeObserver?.disconnect();
  }
  override firstUpdated() {
    // the content grows when a child component redraws, not only when this one does
    this.resizeObserver = new ResizeObserver(() => {
      if (this.stick) this.log.scrollTop = this.log.scrollHeight;
    });
    this.resizeObserver.observe(this.msgs);
  }
  // called from a keydown: focus at once so the key lands in the field. A composer that is not there yet (coming from a view) follows its render
  private onFocus = () => {
    if (this.composer) this.composer.focusInput();
    else this.updateComplete.then(() => this.composer?.focusInput());
  };
  private onBottom = () => {
    this.stick = true;
    requestAnimationFrame(() => {
      this.log.scrollTop = this.log.scrollHeight;
    });
  };
  private onTop = () => {
    this.stick = false;
    requestAnimationFrame(() => {
      this.log.scrollTop = 0;
    });
  };
  private onScroll = () => {
    const distanceToBottom = this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight;
    this.stick = distanceToBottom < 80;
  };

  private get selected() {
    return ui.selected;
  }
  private get board() {
    return boardOf(this.selected);
  }
  private get onView() {
    return isView(this.selected);
  }
  private get terminalSession() {
    return !this.onView && isTerminal(this.selected) ? terminalOf(this.selected) : undefined;
  }
  /** The project of the open conversation or terminal session, null for a general one and for a view. */
  private get projectName() {
    if (this.terminalSession) return this.terminalSession.project;
    return this.onView ? null : projectOf(this.selected);
  }
  /** Whose tools the bar shows: the open conversation's project, or the project whose board or PRs is open. */
  private get toolProject() {
    return this.projectName ?? (this.onView ? (ui.tool?.project ?? null) : null);
  }
  private get heading() {
    // a project's board or PRs reads as that project's: its name first, the view as the subtitle
    if (ui.tool && this.onView) return projectLabel(ui.tool.project);
    if (this.board) return this.board.name;
    switch (this.selected) {
      case PRS:
        return "Pull requests";
      case USAGE:
        return t("nav.usage");
      case MAIL:
        return t("nav.mail");
      case REM:
        return t("nav.reminders");
      case WAIT:
        return t("nav.waiting");
      default:
        return projectLabel(this.projectName);
    }
  }
  private get subheading() {
    if (ui.tool && this.onView) return this.board?.name ?? "Pull requests";
    return this.selected === WAIT ? `${waitCount()}` : "";
  }
  // the terminal would resume a conversation that touched mail without the app's restrictions
  private get terminalLocked() {
    return !!chat.chats[this.selected]?.fromMail;
  }
  private get terminalHidden() {
    const session = this.terminalSession;
    if (this.onView) return true;
    if (session) return session.kind !== "background";
    return agentOf(chatAgent(this.selected))?.caps.terminal === false;
  }
  /** The project this general conversation seems to be about, offered as a move. */
  private get suggestedProject() {
    const busy = chat.status[this.selected] === "busy";
    const asked = this.onView || this.terminalSession || this.projectName || chat.dismissed.has(this.selected) || busy;
    return asked ? null : aboutProject(this.selected);
  }

  private renderView() {
    const selected = this.selected;
    if (this.board) return keyed(this.board.id, html`<relay-board .provider=${this.board}></relay-board>`);
    if (selected === USAGE) return html`<relay-usage></relay-usage>`;
    if (selected === REM) return html`<relay-reminders></relay-reminders>`;
    if (selected === WAIT) return html`<relay-waiting></relay-waiting>`;
    return html`<relay-conversation></relay-conversation>`;
  }

  private get projectTint() {
    const context = vault.snap.projects.find(project => project.name === this.projectName)?.context;
    return context ? contextTint(context) : "";
  }

  private renderBar() {
    const session = this.terminalSession;
    const toolProject = this.toolProject;
    const linkedRef = toolProject ? config.value.boards?.[toolProject] : undefined;
    const linked = linkedRef && provider(linkedRef.provider);
    const active = !ui.tool || !this.onView ? "" : this.board ? "board" : this.selected === PRS ? "prs" : "";
    const ghLinked = !!projectRepos.map[toolProject ?? ""]?.length;
    return html`<relay-chat-bar
      .heading=${this.heading}
      .img=${toolProject ? (vault.icons[toolProject]?.img ?? "") : ""}
      .tint=${this.projectTint}
      .state=${chat.chats[this.selected] ? (chat.status[this.selected] ?? "idle") : ""}
      ?editable=${!this.onView}
      .sub=${this.subheading}
      .value=${session ? session.title : label(this.selected)}
      ?readonly=${!!session}
      ?renamable=${!!chat.chats[this.selected]}
      ?noTerm=${this.terminalHidden}
      ?locked=${this.terminalLocked}
      ?tools=${!!toolProject}
      .board=${linked}
      ?gh=${ghOn()}
      ?ghLinked=${ghLinked}
      .active=${active}
      .drawer=${ui.drawer}
      ?remNew=${this.selected === REM}
      ?prs=${this.selected === PRS}
      .prsAt=${prs.at}
      ?prsBusy=${prs.busy}
      @new-reminder=${openReminderForm}
      @reload-prs=${loadPrs}
      @edit-project=${() => (ui.tool && this.onView ? closeTool() : openProjectPanel())}
      @rename=${(e: CustomEvent<string>) => rename(e.detail)}
      @open-terminal=${openTerminal}
      @open-board=${() => linked && openTool(toolProject!, boardKey(linked.id))}
      @open-prs=${() => (ghLinked ? openTool(toolProject!, PRS) : invoke("open_settings_window"))}
      @toggle-drawer=${(e: CustomEvent<"terminal" | "notes">) => toggleDrawer(e.detail)}
    ></relay-chat-bar>`;
  }

  private renderToast() {
    const toast = ui.toast;
    if (!toast) return nothing;
    return html`<div class=${column}>
      <div class="${strip} mb-2 bg-label text-bg select-none">
        <span>${toast.text}</span
        ><span class="flex-1"></span
        >${toast.undo ? html`<button class="btn bg-transparent! text-bg border-bg/40!" @click=${toast.undo}>${toast.btn}</button>` : nothing}
      </div>
    </div>`;
  }

  // a terminal session says it is read-only here, a general conversation may offer to move to the project it is about
  private renderMoveBar() {
    const session = this.terminalSession;
    if (session) {
      return html`<div class=${column}>
        <div class="${strip} border border-separator bg-fill">
          <span>${t("move.term", { busy: session.status === "busy" ? t("move.termBusy") : "" })}</span>
        </div>
      </div>`;
    }
    const about = this.suggestedProject;
    if (!about) return nothing;
    return html`<div class=${column}>
      <div class="${strip} border border-separator bg-fill">
        <span>${th("move.about", { name: about })}</span><span class="flex-1"></span>
        <button class="btn" @click=${() => moveTo(null)}>${t("move.no")}</button
        ><button class="btn btn-primary" @click=${() => moveTo(about)}>${t("move.yes", { name: about })}</button>
      </div>
    </div>`;
  }

  override render() {
    const hasSubagents = !this.onView && (chat.subs[this.selected] || []).length > 0;
    const messagesWidth = this.board ? "px-5" : this.selected === REM ? "max-w-180 px-8" : "max-w-170 px-8";
    // the Pull requests and Mail views scroll their list and the open item apart, so it fills the pane instead of the log
    if (this.selected === PRS) return html`${this.renderBar()}<relay-prs class="flex-1"></relay-prs>`;
    if (this.selected === MAIL) return html`${this.renderBar()}<relay-mail class="flex-1"></relay-mail>`;
    return html` ${this.renderBar()} ${ui.projectPanel ? html`<relay-project-panel></relay-project-panel>` : nothing}
      <div id="log" class="flex-1 overflow-y-auto pt-7 pb-3" @scroll=${this.onScroll}>
        <div id="msgs" class="mx-auto flex flex-col gap-5 ${messagesWidth}">${this.renderView()}</div>
      </div>
      ${hasSubagents ? html`<relay-subagents class="${column} mb-1.5"></relay-subagents>` : nothing}
      ${this.renderToast()} ${this.renderMoveBar()}
      ${this.onView ? nothing : html`<relay-composer class="${column} mt-2 mb-4.5"></relay-composer>`}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-chat": RelayChat;
  }
}
