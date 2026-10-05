import type { Item } from "./types";

export type Todo = { content: string; status: "pending" | "in_progress" | "completed"; activeForm?: string };

/** The todos in a TodoWrite input; anything else it carries is dropped. */
export function todosIn(input: unknown): Todo[] {
  const list = (input as { todos?: unknown } | undefined)?.todos;
  if (!Array.isArray(list)) return [];
  return list.flatMap(t =>
    t && typeof t.content === "string" && ["pending", "in_progress", "completed"].includes(t.status)
      ? [
          {
            content: t.content,
            status: t.status,
            activeForm: typeof t.activeForm === "string" ? t.activeForm : undefined,
          },
        ]
      : [],
  );
}

/** The conversation's todo list: the last TodoWrite replaces the one before. Subagents' calls never reach the items.
 *  ponytail: TaskCreate/TaskUpdate (newer CLIs) are not folded, they need each call's result for the task id. */
export function currentTodos(items: Item[] | undefined): Todo[] {
  for (let i = (items?.length ?? 0) - 1; i >= 0; i--) {
    const tool = items![i].tool;
    if (tool?.name === "TodoWrite") return todosIn(tool.input);
  }
  return [];
}
