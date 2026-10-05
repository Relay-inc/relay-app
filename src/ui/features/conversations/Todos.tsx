import { useMemo } from "react";
import { useConversationsStore } from "../../../application/conversations/store";
import { useNavigationStore } from "../../../application/navigation/store";
import { currentTodos } from "../../../domain/conversations/todos";
import { useT } from "../../hooks/useT";

/** The conversation's todo list above the composer, next to the agents. Shown while the turn runs, and after it while
 *  something is still open; a finished list goes away with its turn. */
export function Todos({ className }: { className: string }) {
  const { t } = useT();
  const selected = useNavigationStore(s => s.selected);
  const items = useConversationsStore(s => s.messages[selected]);
  const busy = useConversationsStore(s => s.status[selected] === "busy");
  const todos = useMemo(() => currentTodos(items), [items]);
  if (!todos.length || (!busy && todos.every(todo => todo.status === "completed"))) return null;
  const done = todos.filter(todo => todo.status === "completed").length;
  return (
    <div className={`${className} max-h-[30vh] overflow-y-auto text-sm text-secondary`}>
      <div className="px-1.5 text-xs">{t("todos.title", { done, total: todos.length })}</div>
      {todos.map((todo, i) => (
        <div key={i} className="flex items-baseline gap-2 min-h-6 px-1.5">
          <span className="flex-none w-3 text-center text-xs">
            {todo.status === "completed" ? "✓" : todo.status === "in_progress" ? "●" : "○"}
          </span>
          <span
            className={
              todo.status === "completed" ? "line-through" : todo.status === "in_progress" ? "text-label" : undefined
            }
          >
            {todo.status === "in_progress" && todo.activeForm ? todo.activeForm : todo.content}
          </span>
        </div>
      ))}
    </div>
  );
}
