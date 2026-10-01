import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { t, th } from "../core/i18n";
import { emit } from "../core/dom";
import { tw } from "../core/styles";
import type { Pending, Question } from "../domain/chats/state";

type Answer = "allow" | "deny" | { picked: string[][]; other: string[] };
declare global {
  interface HTMLElementEventMap {
    answer: CustomEvent<Answer>;
  }
}

// what a permission card shows: the command, the file (and what is written to it), or the input as it is
function describe(request: Pending): string {
  const input = request.input || {};
  if (request.tool_name === "Bash") return String(input.command ?? "");
  if (input.file_path)
    return String(input.file_path) + (input.content ? `\n\n${String(input.content).slice(0, 600)}` : "");
  return JSON.stringify(input, null, 2).slice(0, 900);
}
// a question with options (kind "question"; files from before the providers only have Claude's tool name)
const isQuestion = (request: Pending) => request.kind === "question" || request.tool_name === "AskUserQuestion";

// a long path never widens the card past its border
const box = "grid grid-cols-1 gap-2.5 rounded-lg border border-accent bg-fill px-3.5 py-3";

/** A pending permission or question of an agent, waiting for the user. `where`: the conversation it belongs to when shown outside it.
 *  The container answers and sets `busy` while it does; a card that is not answered stays usable. */
@customElement("relay-permission-card")
export class PermissionCard extends LitElement {
  static override styles = [
    tw,
    css`
      :host {
        display: block;
      }
    `,
  ];
  @property({ attribute: false }) request!: Pending;
  @property() where = "";
  @property({ type: Boolean }) busy = false;
  // the options picked per question, and what is typed in its "other" field
  @state() private picked: Record<number, Set<string>> = {};
  private other: Record<number, string> = {};

  private pick(questionIndex: number, option: string, multiple: boolean) {
    const current = this.picked[questionIndex];
    const next = new Set(multiple ? current : current?.has(option) ? [option] : []);
    if (next.has(option)) next.delete(option);
    else next.add(option);
    this.picked = { ...this.picked, [questionIndex]: next };
  }
  private answer() {
    const questions = this.request.input.questions || [];
    emit<Answer>(this, "answer", {
      picked: questions.map((question, qi) =>
        (question.options || []).map(option => option.label).filter((label: string) => this.picked[qi]?.has(label)),
      ),
      other: questions.map((_, qi) => this.other[qi] ?? ""),
    });
  }

  private renderQuestion(question: Question, qi: number) {
    return html` <div class="text-base font-semibold text-label">${question.question}</div>
      <div class="flex flex-wrap gap-2">
        ${(question.options || []).map(
          option =>
            html`<button
              class=${this.picked[qi]?.has(option.label) ? "btn btn-primary" : "btn"}
              title=${option.description || ""}
              ?disabled=${this.busy}
              @click=${() => this.pick(qi, option.label, !!question.multiSelect)}
            >
              ${option.label}
            </button>`,
        )}
      </div>
      <input
        class="rounded-md border border-separator bg-bg px-2.5 py-1.5 text-sm text-label placeholder:text-secondary"
        placeholder=${t("card.other")}
        .value=${this.other[qi] ?? ""}
        @input=${(e: Event) => {
          this.other[qi] = (e.target as HTMLInputElement).value;
        }}
      />`;
  }

  private renderQuestionCard() {
    return html`<div class=${box}>
      <div class="text-sm text-secondary">${t("card.asks")}</div>
      ${(this.request.input.questions || []).map((question: Question, qi: number) => this.renderQuestion(question, qi))}
      <div class="flex justify-end gap-2">
        <button class="btn" ?disabled=${this.busy} @click=${() => emit(this, "answer", "deny")}>
          ${t("card.skip")}</button
        ><button class="btn btn-primary" ?disabled=${this.busy} @click=${() => this.answer()}>
          ${t("card.answer")}
        </button>
      </div>
    </div>`;
  }

  private renderPermissionCard() {
    const request = this.request;
    const where = this.where ? t("card.in", { name: this.where }) : "";
    return html`<div class=${box}>
      <div class="text-sm text-secondary [&_code]:font-mono [&_code]:text-xs">
        ${th("card.wants", { tool: request.tool_name, where })}
      </div>
      <pre class="font-mono text-sm whitespace-pre-wrap wrap-anywhere text-label">${describe(request)}</pre>
      <div class="flex justify-end gap-2">
        <button class="btn" ?disabled=${this.busy} @click=${() => emit(this, "answer", "deny")}>
          ${t("card.deny")}</button
        ><button class="btn btn-primary" ?disabled=${this.busy} @click=${() => emit(this, "answer", "allow")}>
          ${t("card.allow")}
        </button>
      </div>
    </div>`;
  }

  override render() {
    return isQuestion(this.request) ? this.renderQuestionCard() : this.renderPermissionCard();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-permission-card": PermissionCard;
  }
}
