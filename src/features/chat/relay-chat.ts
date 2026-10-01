import { LitElement, html, css, nothing } from "lit";
import { customElement, query } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import { t, th } from "../../core/i18n";
import { StoreController, ui as bus } from "../../core/store";
import { tw } from "../../core/styles";
import { ui, WAIT, REM, PRS, MAIL, USAGE, isView, isTerm, boardOf } from "../../domain/ui";
import { chat, termOf, projOf, label, aboutProject, waitCount } from "../../domain/chats/state";
import { rename, openTerminal, moveTo } from "../../domain/chats/actions";
import { openPop, setInsp } from "../../domain/navigation";
import { agentOf, chatAgent } from "../../domain/agents";
import { vault, pLabel } from "../../domain/vault";
import "./chat-bar";
import "./project-panel";
import "../board/relay-board";
import "../pull-requests/relay-prs";
import "../usage/relay-usage";
import "../mail/relay-mail";
import "../reminders/relay-reminders";
import "../waiting/relay-waiting";
import "../conversation/relay-conversation";
import "../composer/relay-composer";
import "../subagents/relay-subagents";
import type { RelayComposer } from "../composer/relay-composer";

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
  private ro?: ResizeObserver;
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
    this.ro?.disconnect();
  }
  override firstUpdated() {
    // the content grows when a child component redraws, not only when this one does
    this.ro = new ResizeObserver(() => {
      if (this.stick) this.log.scrollTop = this.log.scrollHeight;
    });
    this.ro.observe(this.msgs);
  }
  // called from a keydown: focus at once so the key lands in the field. A composer that is not there yet (coming from a view) follows its render
  private onFocus = () => {
    const c = this.composer;
    if (c) c.focusInput();
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
    const l = this.log;
    this.stick = l.scrollHeight - l.scrollTop - l.clientHeight < 80;
  };

  private view(bp: ReturnType<typeof boardOf>) {
    const sel = ui.sel;
    if (bp) return keyed(bp.id, html`<relay-board .provider=${bp}></relay-board>`);
    if (sel === PRS) return html`<relay-prs></relay-prs>`;
    if (sel === USAGE) return html`<relay-usage></relay-usage>`;
    if (sel === MAIL) return html`<relay-mail></relay-mail>`;
    if (sel === REM) return html`<relay-reminders></relay-reminders>`;
    if (sel === WAIT) return html`<relay-waiting></relay-waiting>`;
    return html`<relay-conversation></relay-conversation>`;
  }

  override render() {
    const sel = ui.sel,
      bp = boardOf(sel),
      isv = isView(sel),
      busy = chat.status[sel] === "busy";
    const T = !isv && isTerm(sel) ? termOf(sel) : undefined,
      pn = T ? T.project : isv ? null : projOf(sel);
    let heading = "",
      sub = "";
    if (bp) heading = bp.name;
    else if (sel === PRS) heading = "Pull requests";
    else if (sel === USAGE) heading = t("nav.usage");
    else if (sel === MAIL) heading = t("nav.mail");
    else if (sel === REM) heading = t("nav.reminders");
    else if (sel === WAIT) {
      heading = t("nav.waiting");
      sub = `${waitCount()}`;
    } else {
      ui.lastP = pn;
      heading = pLabel(pn);
    }
    // the terminal would resume a conversation that touched mail without the app's restrictions
    const locked = !!chat.chats[sel]?.fromMail;
    const noTerm = isv || (!!T && T.kind !== "background") || (!T && agentOf(chatAgent(sel))?.caps.terminal === false);
    const about = !isv && !T && !pn && !chat.dismissed.has(sel) && !busy ? aboutProject(sel) : null;
    const tt = ui.toast,
      subs = isv ? [] : chat.subs[sel] || [];
    // a card over the bar's width: toast and move bar share the log's column
    // the strips under the log line up with the messages: the same column, its padding as the gutter
    const col = "block w-full max-w-2xl mx-auto px-7",
      strip = "flex items-center gap-2 px-3 py-2 rounded-lg text-sm";
    return html` <relay-chat-bar
        .heading=${heading}
        .img=${!isv && pn ? (vault.icons[pn]?.img ?? "") : ""}
        ?editable=${!isv}
        .sub=${sub}
        .value=${T ? T.title : label(sel)}
        ?readonly=${!!T}
        ?renamable=${!!chat.chats[sel]}
        ?noTerm=${noTerm}
        ?locked=${locked}
        ?panelOff=${ui.noinsp}
        @edit-project=${openPop}
        @rename=${(e: CustomEvent<string>) => rename(e.detail)}
        @open-terminal=${openTerminal}
        @toggle-panel=${() => setInsp(!ui.noinsp)}
      ></relay-chat-bar>
      ${ui.pop ? html`<relay-project-panel></relay-project-panel>` : nothing}
      <div id="log" class="flex-1 overflow-y-auto pt-6 pb-2" @scroll=${this.onScroll}>
        <div id="msgs" class=${"mx-auto flex flex-col gap-4 " + (bp ? "px-5" : "max-w-2xl px-7")}>${this.view(bp)}</div>
      </div>
      ${subs.length ? html`<relay-subagents class="${col} mb-1.5"></relay-subagents>` : nothing}
      ${
        tt
          ? html`<div class=${col}>
              <div class="${strip} mb-2 bg-label text-bg select-none">
                <span>${tt.text}</span
                ><span class="flex-1"></span
                >${tt.undo ? html`<button class="btn bg-transparent! text-bg border-bg/40!" @click=${tt.undo}>${tt.btn}</button>` : nothing}
              </div>
            </div>`
          : nothing
      }
      ${
        T
          ? html`<div class=${col}>
              <div class="${strip} border border-separator bg-fill">
                <span>${t("move.term", { busy: T.status === "busy" ? t("move.termBusy") : "" })}</span>
              </div>
            </div>`
          : about
            ? html`<div class=${col}>
                <div class="${strip} border border-separator bg-fill">
                  <span>${th("move.about", { name: about })}</span><span class="flex-1"></span>
                  <button class="btn" @click=${() => moveTo(null)}>${t("move.no")}</button
                  ><button class="btn btn-primary" @click=${() => moveTo(about)}>
                    ${t("move.yes", { name: about })}
                  </button>
                </div>
              </div>`
            : nothing
      }
      ${isv ? nothing : html`<relay-composer class="${col} mt-2 mb-5"></relay-composer>`}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-chat": RelayChat;
  }
}
