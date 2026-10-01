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

  override render() {
    return html`<ul class="list-none">
      ${this.items.map(
        i =>
          html`<li class="flex items-start gap-2 py-2 border-b border-separator text-sm leading-snug">
            <input class="mt-0.5 size-4 flex-none accent-accent" type="checkbox" disabled /><span
              ><span class="line-clamp-3">${md(i.text)}</span>${
                i.when === undefined
                  ? nothing
                  : html`<span class="text-secondary tabular-nums"
                      >${i.project === undefined ? nothing : html`${i.project} · `}<span class=${DUE[i.due ?? ""]}
                        >${i.when}</span
                      ></span
                    >`
              }</span
            >
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
