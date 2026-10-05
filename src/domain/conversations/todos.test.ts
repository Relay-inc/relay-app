import { test } from "node:test";
import assert from "node:assert/strict";
import { currentTodos, todosIn } from "./todos.ts";
import type { Item } from "./types";

const write = (todos: unknown): Item => ({ kind: "tool", text: "", tool: { name: "TodoWrite", input: { todos } } });
const a = { content: "A", status: "completed", activeForm: "Doing A" };
const b = { content: "B", status: "in_progress", activeForm: "Doing B" };

test("the last TodoWrite is the list", () => {
  const items: Item[] = [write([a]), { kind: "ai", text: "x" }, write([a, b])];
  assert.deepEqual(currentTodos(items), [a, b]);
});
test("no TodoWrite, no list", () => {
  assert.deepEqual(currentTodos(undefined), []);
  assert.deepEqual(currentTodos([{ kind: "ai", text: "x" }]), []);
});
test("bad entries are dropped", () => {
  assert.deepEqual(todosIn({ todos: [a, { content: "C", status: "weird" }, null, 3] }), [a]);
  assert.deepEqual(todosIn({}), []);
});
