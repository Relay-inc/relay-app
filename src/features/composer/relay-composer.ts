import { LitElement, html, css, nothing } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { t } from "../../core/i18n";
import { icon } from "../../core/icons";
import { StoreController } from "../../core/store";
import { tw } from "../../core/styles";
import { ui, isTerm } from "../../domain/ui";
import { chat, termOf, projOf } from "../../domain/chats/state";
import { project } from "../../domain/vault";
import { chatAgent, agentOf, onAgents, picks, setPick } from "../../domain/agents";
import { setTyped, sendMsg, sendOrStop, attach, unattach, setAgent } from "../../domain/chats/actions";
import { zoom } from "../../domain/navigation";
import { pastedImages, hasFiles } from "../../components/image-files";
import "../../components/image-thumbs";

type Pick = { id: string; label: string };

/** The message field with the images waiting, the agent, model and effort picks and the send button. */
@customElement("relay-composer")
export class RelayComposer extends LitElement {
  // the field and the picks drop the browser's look entirely (`all:unset`), which a utility can't say
  static styles = [tw, css`
    :host{display:block;flex:none}
    textarea{all:unset;display:block;width:100%;min-height:24px;font-size:16px;line-height:1.45;color:var(--label)}
    textarea::placeholder{color:var(--secondary)}
    select{all:unset;font-size:12px;color:var(--secondary);padding:2px 4px;border-radius:calc(var(--r) - 2px);cursor:default}
    select:hover:not(:disabled){background:var(--fill)}
    select:disabled{opacity:.5}`];
  protected store = new StoreController(this);
  @state() private dropping = false;
  @query("textarea") private ta!: HTMLTextAreaElement | null;
  private grown = "";

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
    return html`<select ?hidden=${!show} ?disabled=${busy} title=${t(`composer.${kind}`)} aria-label=${t(`composer.${kind}`)} @change=${(e: Event) => setPick(kind, (e.target as HTMLSelectElement).value)}>
      <option value="" .selected=${value === ""}>${def}</option>${list.map(c => html`<option value=${c.id} .selected=${c.id === value}>${c.label}</option>`)}</select>`;
  }

  render() {
    const sel = ui.sel, T = isTerm(sel) ? termOf(sel) : undefined, pn = T ? T.project : projOf(sel), P = project(pn);
    const busy = chat.status[sel] === "busy", id = chatAgent(sel), st = agentOf(id), on = onAgents();
    // the agent is fixed once a conversation has a message; with one agent there is nothing to pick
    const showAgent = on.length > 1 && !isTerm(sel) && !!chat.chats[sel];
    const model = picks("model"), effort = picks("effort");
    const box = "rounded-lg bg-bg border p-[10px_12px_8px] [box-shadow:0_0_0_.5px_var(--separator),0_1px_2px_rgba(0,0,0,.06)] focus-within:border-accent";
    return html`<div class=${this.dropping ? `${box} border-accent bg-[color-mix(in_srgb,var(--accent)_6%,var(--bg))]` : `${box} border-separator`}
        @dragover=${(e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); this.dropping = true; }} @dragleave=${() => { this.dropping = false; }} @drop=${this.onDrop}>
      ${chat.attached.length ? html`<relay-image-thumbs class="mb-2" removable .urls=${chat.attached.map(a => a.url)}
        @remove=${(e: CustomEvent<number>) => { unattach(e.detail); this.focusInput(); }} @open=${(e: CustomEvent<string>) => zoom(e.detail)}></relay-image-thumbs>` : nothing}
      <textarea rows="1" .value=${live(chat.typed[sel] ?? "")} placeholder=${T ? t("ph.term") : P ? t("ph.project", { name: pn ?? "" }) : t("ph.general")}
        @keydown=${this.onKey} @input=${this.onInput} @paste=${(e: ClipboardEvent) => { const f = pastedImages(e); if (f.length) attach(f); }}></textarea>
      <div class="flex items-center gap-2 mt-[6px] text-secondary">
        ${showAgent ? html`<select ?disabled=${!!(chat.convo[sel] || []).length || !!chat.chats[sel]?.fork} title=${t("composer.agent")} aria-label=${t("composer.agent")}
          @change=${(e: Event) => setAgent((e.target as HTMLSelectElement).value)}>${on.map(p => html`<option value=${p.id} .selected=${p.id === id}>${p.name}</option>`)}</select>` : nothing}
        <!-- a switch restarts the process, so not while a turn runs -->
        ${this.select("model", model.list, model.value, t("composer.defaultModel"), true, busy)}
        ${this.select("effort", effort.list, effort.value, t("composer.defaultEffort"), !st || (st.caps.effort && st.efforts.length > 0), busy)}
        <span class="flex-1"></span>
        <button class=${busy ? "grid place-items-center size-[26px] rounded-lg border-0 bg-label text-on-accent" : "grid place-items-center size-[26px] rounded-lg border-0 bg-accent text-on-accent"} aria-label=${t("composer.send")} @click=${sendOrStop}>${icon(busy ? "stop" : "send", "glyph size-[14px] [stroke-width:1.6]")}</button></div></div>`;
  }
}
