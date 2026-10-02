import { Markdown } from "../../components/Markdown";

/** One line of the list: the text (markdown), and under it, optionally, "project · when" in the urgency's colour. */
type Todo = { text: string; project?: string; when?: string; due?: "late" | "soon" | "" };

const DUE = { late: "due-late", soon: "due-soon", "": "" };

/** The right panel's read-only checklist: reminders and a project's open items. */
export function TodoList({ items }: { items: Todo[] }) {
  return (
    <ul className="list-none">
      {items.map((todo, i) => (
        <li key={i} className="flex items-start gap-2 py-2 border-b border-separator text-sm leading-snug">
          <input className="mt-0.5 size-4 flex-none accent-accent" type="checkbox" disabled />
          <span>
            <Markdown className="line-clamp-3" text={todo.text} />
            {todo.when === undefined ? null : (
              <span className="text-secondary tabular-nums">
                {todo.project ? `${todo.project} · ` : null}
                <span className={DUE[todo.due ?? ""]}>{todo.when}</span>
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
