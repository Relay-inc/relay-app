import { html, nothing } from "lit";
import { live } from "lit/directives/live.js";
import { classMap } from "lit/directives/class-map.js";
import { t } from "../i18n";
import { RelayElement, styles } from "../lib/store";
import { icon } from "../icons";
import { S, isTerm, termOf, projOf, project, chatAgent, agentOf, onAgents, picks } from "../app/state";
import { setTyped, sendMsg, sendOrStop, attach, unattach, setAgent, setPick } from "../app/actions";
import { thumbs, pastedImages, hasFiles } from "./parts";
import parts from "./parts.css?inline";
import css from "./composer.css?inline";

type Pick = { id: string; label: string };

/** The message field with the images waiting, the agent, model and effort picks and the send button. */
export class RelayComposer extends RelayElement {
  static styles = styles(parts + css);
  static properties = { dropping: { state: true } };
  declare dropping: boolean;
  private grown = "";
  constructor() { super(); this.dropping = false; }

  private get ta() { return this.renderRoot.querySelector("textarea") as HTMLTextAreaElement | null; }
  focusInput() {
    const ta = this.ta;
    if (ta) ta.focus(); else this.updateComplete.then(() => this.ta?.focus());
  }
  private grow() { const ta = this.ta; if (!ta) return; ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; this.grown = ta.value; }
  // switching to another conversation puts other text in the field
  updated() { if (this.ta && this.ta.value !== this.grown) this.grow(); }

  private onKey(e: KeyboardEvent) { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendMsg(); } }
  private onInput(e: Event) { setTyped((e.target as HTMLTextAreaElement).value); this.grow(); }
  private onDrop(e: DragEvent) {
    this.dropping = false;
    if (!hasFiles(e)) return;
    e.preventDefault(); attach([...e.dataTransfer!.files]);
  }
  private select(kind: "model" | "effort", list: Pick[], value: string, def: string, show: boolean, busy: boolean) {
    return html`<select class="pick" ?hidden=${!show} ?disabled=${busy} title=${t(`composer.${kind}`)} aria-label=${t(`composer.${kind}`)} @change=${(e: Event) => setPick(kind, (e.target as HTMLSelectElement).value)}>
      <option value="" .selected=${value === ""}>${def}</option>${list.map(c => html`<option value=${c.id} .selected=${c.id === value}>${c.label}</option>`)}</select>`;
  }

  render() {
    const sel = S.sel, T = isTerm(sel) ? termOf(sel) : undefined, pn = T ? T.project : projOf(sel), P = project(pn);
    const busy = S.status[sel] === "busy", id = chatAgent(sel), st = agentOf(id), on = onAgents();
    // the agent is fixed once a conversation has a message; with one agent there is nothing to pick
    const showAgent = on.length > 1 && !isTerm(sel) && !!S.chats[sel];
    const model = picks("model"), effort = picks("effort");
    return html`<div class=${classMap({ composer: true, drop: this.dropping })}
        @dragover=${(e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); this.dropping = true; }} @dragleave=${() => { this.dropping = false; }} @drop=${this.onDrop}>
      <div class="atts" ?hidden=${!S.attached.length}>${thumbs(S.attached.map(a => a.url), i => { unattach(i); this.focusInput(); })}</div>
      <textarea rows="1" .value=${live(S.typed[sel] ?? "")} placeholder=${T ? t("ph.term") : P ? t("ph.project", { name: pn ?? "" }) : t("ph.general")}
        @keydown=${this.onKey} @input=${this.onInput} @paste=${(e: ClipboardEvent) => { const f = pastedImages(e); if (f.length) attach(f); }}></textarea>
      <div class="cfoot">
        ${showAgent ? html`<select class="pick" ?disabled=${!!(S.convo[sel] || []).length || !!S.chats[sel]?.fork} title=${t("composer.agent")} aria-label=${t("composer.agent")}
          @change=${(e: Event) => setAgent((e.target as HTMLSelectElement).value)}>${on.map(p => html`<option value=${p.id} .selected=${p.id === id}>${p.name}</option>`)}</select>` : nothing}
        <!-- a switch restarts the process, so not while a turn runs -->
        ${this.select("model", model.list, model.value, t("composer.defaultModel"), true, busy)}
        ${this.select("effort", effort.list, effort.value, t("composer.defaultEffort"), !st || (st.caps.effort && st.efforts.length > 0), busy)}
        <span class="sp"></span>
        <button class=${busy ? "send stop" : "send"} aria-label=${t("composer.send")} @click=${sendOrStop}>${icon(busy ? "stop" : "send", "i")}</button></div></div>`;
  }
}
customElements.define("relay-composer", RelayComposer);
