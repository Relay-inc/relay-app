import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import { t, th } from "../core/i18n";
import { emit } from "../core/dom";
import { tw } from "../core/styles";
import type { Pending } from "../domain/chats/state";

type Answer = "allow" | "deny" | { picked: string[][]; other: string[] };
declare global {
  interface HTMLElementEventMap {
    answer: CustomEvent<Answer>;
  }
}

// what a permission card shows: the command, the file (and what is written to it), or the input as it is
function describe(r: Pending): string {
  const i = r.input || {};
  if (r.tool_name === "Bash") return String(i.command ?? "");
  if (i.file_path) return String(i.file_path) + (i.content ? `\n\n${String(i.content).slice(0, 600)}` : "");
  return JSON.stringify(i, null, 2).slice(0, 900);
}
// a question with options (kind "question"; files from before the providers only have Claude's tool name)
const isQuestion = (r: Pending) => r.kind === "question" || r.tool_name === "AskUserQuestion";

/** A pending permission or question of an agent, waiting for the user. `where`: the conversation it belongs to when shown outside it.
 *  The container answers and sets `busy` while it does; a card that is not answered stays usable. */
@customElement("relay-permission-card")
export class PermissionCard extends LitElement {
  static styles = [tw, css`:host{display:block}`];
  @property({ attribute: false }) request!: Pending;
  @property() where = "";
  @property({ type: Boolean }) busy = false;
  // the options picked per question, and what is typed in its "other" field
  private on: Record<number, Set<string>> = {};
  private other: Record<number, string> = {};

  private pick(qi: number, lab: string, multi: boolean) {
    const s = this.on[qi] ||= new Set();
    if (s.has(lab)) s.delete(lab);
    else { if (!multi) s.clear(); s.add(lab); }
    this.requestUpdate();
  }
  private answer() {
    const qs: any[] = this.request.input.questions || [];
    emit<Answer>(this, "answer", {
      picked: qs.map((q, qi) => (q.options || []).map((o: any) => o.label).filter((l: string) => this.on[qi]?.has(l))),
      other: qs.map((_, qi) => this.other[qi] ?? ""),
    });
  }

  render() {
    const r = this.request, busy = this.busy;
    const box = "grid grid-cols-[minmax(0,1fr)] gap-[10px] rounded-lg border border-accent bg-fill px-[14px] py-3"; // a long path never widens the card past its border
    if (isQuestion(r)) return html`<div class=${box}><div class="text-sm text-secondary">${t("card.asks")}</div>${(r.input.questions || []).map((q: any, qi: number) => html`
      <div class="text-lg font-semibold text-label">${q.question}</div>
      <div class="flex flex-wrap gap-2">${(q.options || []).map((o: any) => html`<button class=${this.on[qi]?.has(o.label) ? "btn btn-primary" : "btn"} title=${o.description || ""} ?disabled=${busy}
        @click=${() => this.pick(qi, o.label, !!q.multiSelect)}>${o.label}</button>`)}</div>
      <input class="rounded-[6px] border border-separator bg-bg px-[10px] py-[6px] text-sm text-label placeholder:text-[#757575]" placeholder=${t("card.other")} .value=${this.other[qi] ?? ""} @input=${(e: Event) => { this.other[qi] = (e.target as HTMLInputElement).value; }}>`)}
      <div class="flex justify-end gap-2"><button class="btn" ?disabled=${busy} @click=${() => emit(this, "answer", "deny")}>${t("card.skip")}</button><button class="btn btn-primary" ?disabled=${busy} @click=${() => this.answer()}>${t("card.answer")}</button></div></div>`;
    return html`<div class=${box}><div class="text-sm text-secondary [&_code]:font-mono [&_code]:text-[12.5px]">${th("card.wants", { tool: r.tool_name, where: this.where ? t("card.in", { name: this.where }) : "" })}</div>
      <pre class="font-mono text-sm whitespace-pre-wrap [overflow-wrap:anywhere] text-label">${describe(r)}</pre>
      <div class="flex justify-end gap-2"><button class="btn" ?disabled=${busy} @click=${() => emit(this, "answer", "deny")}>${t("card.deny")}</button><button class="btn btn-primary" ?disabled=${busy} @click=${() => emit(this, "answer", "allow")}>${t("card.allow")}</button></div></div>`;
  }
}
