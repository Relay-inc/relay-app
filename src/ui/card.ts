import { html } from "lit";
import { classMap } from "lit/directives/class-map.js";
import { t, th } from "../i18n";
import { RelayElement, styles } from "../lib/store";
import { S, label } from "../app/state";
import { answer } from "../app/actions";
import parts from "./parts.css?inline";
import css from "./card.css?inline";

// what a permission card shows: the command, the file (and what is written to it), or the input as it is
function describe(r: any): string {
  const i = r.input || {};
  if (r.tool_name === "Bash") return String(i.command ?? "");
  if (i.file_path) return String(i.file_path) + (i.content ? `\n\n${String(i.content).slice(0, 600)}` : "");
  return JSON.stringify(i, null, 2).slice(0, 900);
}
// a question with options (kind "question"; files from before the providers only have Claude's tool name)
const isQuestion = (r: any) => r.kind === "question" || r.tool_name === "AskUserQuestion";

/** A pending permission or question of an agent, waiting for the user. */
export class RelayCard extends RelayElement {
  static styles = styles(parts + css);
  static properties = { r: { attribute: false }, busy: { state: true } };
  declare r: any;
  declare busy: boolean;
  // the options picked per question, and what is typed in its "other" field
  private on: Record<number, Set<string>> = {};
  private other: Record<number, string> = {};
  constructor() { super(); this.busy = false; }

  private pick(qi: number, lab: string, multi: boolean) {
    const s = this.on[qi] ||= new Set();
    if (s.has(lab)) s.delete(lab);
    else { if (!multi) s.clear(); s.add(lab); }
    this.requestUpdate();
  }
  private async decide(act: "allow" | "deny" | "answer") {
    const r = this.r;
    let decision: any;
    if (act === "allow") decision = { behavior: "allow", updatedInput: r.input };
    else if (act === "deny") decision = { behavior: "deny", message: isQuestion(r) ? "Laurent sloeg de vraag over en antwoordt zelf in het gesprek. Wacht op zijn bericht." : "Geweigerd in de app." };
    else {
      const answers: Record<string, string> = {};
      (r.input.questions || []).forEach((q: any, qi: number) => {
        const on = (q.options || []).map((o: any) => o.label).filter((l: string) => this.on[qi]?.has(l));
        const other = (this.other[qi] ?? "").trim();
        if (other) on.push(other);
        if (on.length) answers[q.question] = on.join(", ");
      });
      if (!Object.keys(answers).length) return;
      decision = { behavior: "allow", updatedInput: { ...r.input, answers } };
    }
    this.busy = true;
    try { await answer(r, decision); } finally { this.busy = false; }
  }

  render() {
    const r = this.r, busy = this.busy;
    if (isQuestion(r)) return html`<div class="perm"><div class="q">${t("card.asks")}</div>${(r.input.questions || []).map((q: any, qi: number) => html`
      <div class="qh">${q.question}</div>
      <div class="opts">${(q.options || []).map((o: any) => html`<button class=${classMap({ btn: true, on: !!this.on[qi]?.has(o.label) })} title=${o.description || ""} ?disabled=${busy}
        @click=${() => this.pick(qi, o.label, !!q.multiSelect)}>${o.label}</button>`)}</div>
      <input class="other" placeholder=${t("card.other")} .value=${this.other[qi] ?? ""} @input=${(e: Event) => { this.other[qi] = (e.target as HTMLInputElement).value; }}>`)}
      <div class="acts"><button class="btn" ?disabled=${busy} @click=${() => this.decide("deny")}>${t("card.skip")}</button><button class="btn primary" ?disabled=${busy} @click=${() => this.decide("answer")}>${t("card.answer")}</button></div></div>`;
    return html`<div class="perm"><div class="q">${th("card.wants", { tool: r.tool_name, where: r.project && r.project !== S.sel ? t("card.in", { name: label(r.project) }) : "" })}</div>
      <pre>${describe(r)}</pre>
      <div class="acts"><button class="btn" ?disabled=${busy} @click=${() => this.decide("deny")}>${t("card.deny")}</button><button class="btn primary" ?disabled=${busy} @click=${() => this.decide("allow")}>${t("card.allow")}</button></div></div>`;
  }
}
customElements.define("relay-card", RelayCard);
