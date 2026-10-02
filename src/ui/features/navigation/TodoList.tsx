import { Markdown } from "../../components/Markdown";

/** One line of the list: the text (markdown), and under it, optionally, "project · when" in the urgency's colour. */
type Todo = { text: string; project?: string; when?: string; due?: "late" | "soon" | "" };

const DUE = { late: "due-late", soon: "due-soon", "": "" };

/** The right panel's read-only checklist: reminders and a project's open items. */
export function TodoList({ items }: { items: Todo[] }) {
  return (
    <ul className="list-none">
      {items.map((todo, i) => (
        <li key={i} className="flex items-start gap-2.5 py-2.25 border-b border-separator text-[13px] leading-snug">
          {/* reminders carry a date line and no box; an open item is a (read-only, so always empty) checkbox */}
          {todo.when === undefined ? (
            <span className="mt-px size-4 flex-none rounded-[5px] border-[1.5px] border-separator-strong" />
          ) : null}
          <span className="min-w-0 flex flex-col gap-0.5">
            <Markdown className="line-clamp-3" text={todo.text} />
            {todo.when === undefined ? null : (
              <span className="block text-xs text-secondary tabular-nums">
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
