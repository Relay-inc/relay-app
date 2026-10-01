import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { md } from "../../core/markdown";
import { tw } from "../../core/styles";

/** One line of the list: the text (markdown), and under it, optionally, "project · when" in the urgency's colour. */
export type Todo = { text: string; project?: string; when?: unknown; due?: "late" | "soon" | "" };

const DUE = { late: "due-late", soon: "due-soon", "": "" };

/** The right panel's read-only checklist: reminders and a project's open items. */
@customElement("relay-todo-list")
export class TodoList extends LitElement {
  static override styles = [
    tw,
    css`
      :host {
        display: block;
      }
    `,
  ];
  @property({ attribute: false }) items: Todo[] = [];

  private renderWhen(todo: Todo) {
    if (todo.when === undefined) return nothing;
    return html`<span class="block text-xs text-secondary tabular-nums"
      >${todo.project === undefined ? nothing : html`${todo.project} · `}<span class=${DUE[todo.due ?? ""]}
        >${todo.when}</span
      ></span
    >`;
  }

  // reminders carry a date line and no box; an open item is a (read-only, so always empty) checkbox
  override render() {
    return html`<ul class="list-none">
      ${this.items.map(
        todo =>
          html`<li class="flex items-start gap-2.5 py-2.25 border-b border-separator text-[13px] leading-snug">
            ${todo.when === undefined
              ? html`<span class="mt-px size-4 flex-none rounded-[5px] border-[1.5px] border-separator-strong"></span>`
              : nothing}
            <span class="min-w-0 flex flex-col gap-0.5"><span class="line-clamp-3">${md(todo.text)}</span>${this.renderWhen(todo)}</span>
          </li>`,
      )}
    </ul>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-todo-list": TodoList;
  }
}
