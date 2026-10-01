import { html, nothing } from "lit";
import { keyed } from "lit/directives/keyed.js";
import { live } from "lit/directives/live.js";
import { ifDefined } from "lit/directives/if-defined.js";
import { t, th } from "../i18n";
import { RelayElement, styles, ui } from "../lib/store";
import { icon } from "../icons";
import { iconImg } from "../project-icons";
import { S, WAIT, REM, PRS, MAIL, USAGE, isView, isTerm, termOf, projOf, pLabel, label, boardOf, agentOf, chatAgent, aboutProject, waitCount } from "../app/state";
import { rename, openTerminal, openPop, setInsp, moveTo } from "../app/actions";
import css from "./chat.css?inline";
import "../board";
import "../usage";
import "../reminders";
import "./prs";
import "./mail-view";
import "./waiting";
import "./conversation";
import "./composer";
import "./subs";
import "./pop";
import type { RelayComposer } from "./composer";

/** The centre column: the title bar, the open conversation or view, the agents it spawned, the composer. */
export class RelayChat extends RelayElement {
  static styles = styles(css);
  // the conversation title while it is edited: a redraw must not take the text away from under the caret
  private draft: string | null = null;
  // stay at the bottom while it grows: true when the log was within 80 px of the bottom, followed by every resize of its content
  private stick = true;
  private ro?: ResizeObserver;
  private get log() { return this.renderRoot.querySelector(".log") as HTMLElement; }
  private get composer() { return this.renderRoot.querySelector("relay-composer") as RelayComposer | null; }

  connectedCallback() {
    super.connectedCallback();
    ui.addEventListener("focus-composer", this.onFocus);
    ui.addEventListener("scroll-bottom", this.onBottom);
    ui.addEventListener("scroll-top", this.onTop);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    ui.removeEventListener("focus-composer", this.onFocus);
    ui.removeEventListener("scroll-bottom", this.onBottom);
    ui.removeEventListener("scroll-top", this.onTop);
    this.ro?.disconnect();
  }
  firstUpdated() {
    // the content grows when a child component redraws, not only when this one does
    this.ro = new ResizeObserver(() => { if (this.stick) this.log.scrollTop = this.log.scrollHeight; });
    this.ro.observe(this.renderRoot.querySelector(".msgs")!);
  }
  // called from a keydown: focus at once so the key lands in the field. A composer that is not there yet (coming from a view) follows its render
  private onFocus = () => {
    const c = this.composer;
    if (c) c.focusInput(); else this.updateComplete.then(() => this.composer?.focusInput());
  };
  private onBottom = () => { this.stick = true; requestAnimationFrame(() => { this.log.scrollTop = this.log.scrollHeight; }); };
  private onTop = () => { this.stick = false; requestAnimationFrame(() => { this.log.scrollTop = 0; }); };
  private onScroll = () => { const l = this.log; this.stick = l.scrollHeight - l.scrollTop - l.clientHeight < 80; };

  private setTitle(ct: HTMLInputElement, v: string) { ct.value = v; ct.size = Math.max(4, v.length); this.draft = null; }
  private onTitleKey(e: KeyboardEvent) {
    const ct = e.target as HTMLInputElement;
    if (e.key === "Enter") { e.preventDefault(); ct.blur(); }
    else if (e.key === "Escape") { e.preventDefault(); this.setTitle(ct, label(S.sel)); ct.blur(); }
  }

  private view(bp: ReturnType<typeof boardOf>) {
    const sel = S.sel;
    if (bp) return keyed(bp.id, html`<relay-board .provider=${bp}></relay-board>`);
    if (sel === PRS) return html`<relay-prs></relay-prs>`;
    if (sel === USAGE) return html`<relay-usage></relay-usage>`;
    if (sel === MAIL) return html`<relay-mail></relay-mail>`;
    if (sel === REM) return html`<relay-reminders></relay-reminders>`;
    if (sel === WAIT) return html`<relay-waiting></relay-waiting>`;
    return html`<relay-conversation></relay-conversation>`;
  }

  render() {
    const sel = S.sel, bp = boardOf(sel), isv = isView(sel), busy = S.status[sel] === "busy";
    const T = !isv && isTerm(sel) ? termOf(sel) : undefined, pn = T ? T.project : isv ? null : projOf(sel);
    let title: unknown = "", sub = "";
    if (bp) title = bp.name;
    else if (sel === PRS) title = "Pull requests";
    else if (sel === USAGE) title = t("nav.usage");
    else if (sel === MAIL) title = t("nav.mail");
    else if (sel === REM) title = t("nav.reminders");
    else if (sel === WAIT) { title = t("nav.waiting"); sub = `${waitCount()}`; }
    else { S.lastP = pn; title = html`${iconImg(pn ? S.icons[pn]?.img : "")}${pLabel(pn)}`; }
    // the terminal would resume a conversation that touched mail without the app's restrictions
    const locked = !!S.chats[sel]?.fromMail;
    const noTerm = isv || (T && T.kind !== "background") || (!T && agentOf(chatAgent(sel))?.caps.terminal === false);
    // a terminal session takes its title from the transcript
    const shown = this.draft ?? (T ? T.title : label(sel));
    const about = !isv && !T && !pn && !S.dismissed.has(sel) && !busy ? aboutProject(sel) : null;
    const tt = S.toast, subs = isv ? [] : S.subs[sel] || [];
    return html`
      <div class="bar" data-tauri-drag-region>
        <h1 class=${isv ? "" : "editable"} title=${ifDefined(isv ? undefined : t("chat.editTitle"))} @click=${openPop}>${title}</h1>
        ${isv ? nothing : html`<span class="crumb">›</span>
          <input class="ctitle" spellcheck="false" aria-label=${t("bar.chatTitle")} ?readonly=${!!T} title=${T ? t("chat.titleFromTerm") : t("chat.titleEdit")}
            size=${Math.max(4, shown.length)} .value=${live(shown)}
            @input=${(e: Event) => { const ct = e.target as HTMLInputElement; this.draft = ct.value; ct.size = Math.max(4, ct.value.length); }}
            @keydown=${this.onTitleKey}
            @change=${(e: Event) => { const ct = e.target as HTMLInputElement, v = ct.value.trim(); if (!S.chats[sel] || !v) this.setTitle(ct, label(sel)); else { this.draft = null; rename(v); } }}>`}
        <span class="sub">${sub}</span><span class="sp" data-tauri-drag-region></span>
        <button class="tb ib" ?hidden=${noTerm} ?disabled=${locked} title=${t(locked ? "bar.termMail" : "bar.openTerminal")} aria-label=${t("bar.openTerminal")} @click=${openTerminal}>${icon("term")}</button>
        <button class=${S.noinsp ? "tb ib on" : "tb ib"} title=${t("bar.togglePanelTitle")} aria-label=${t("bar.togglePanel")} @click=${() => setInsp(!S.noinsp)}>
          <svg class="g" viewBox="0 0 16 16"><rect x="2.5" y="3" width="11" height="10" rx="1.5"/><path d="M10 3v10"/></svg></button></div>
      ${S.pop ? html`<relay-pop></relay-pop>` : nothing}
      <div class="log" @scroll=${this.onScroll}><div class=${bp ? "msgs wide" : "msgs"}>${this.view(bp)}</div></div>
      ${subs.length ? html`<relay-subs></relay-subs>` : nothing}
      ${tt ? html`<div class="toast"><span>${tt.text}</span><span class="sp"></span>${tt.undo ? html`<button class="btn" @click=${tt.undo}>${tt.btn}</button>` : nothing}</div>` : nothing}
      ${T ? html`<div class="movebar"><span>${t("move.term", { busy: T.status === "busy" ? t("move.termBusy") : "" })}</span></div>`
        : about ? html`<div class="movebar"><span>${th("move.about", { name: about })}</span><span class="sp"></span>
          <button class="btn" @click=${() => moveTo(null)}>${t("move.no")}</button><button class="btn primary" @click=${() => moveTo(about)}>${t("move.yes", { name: about })}</button></div>` : nothing}
      ${isv ? nothing : html`<relay-composer></relay-composer>`}`;
  }
}
customElements.define("relay-chat", RelayChat);
