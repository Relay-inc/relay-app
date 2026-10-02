import { test } from "node:test";
import assert from "node:assert/strict";
import type { BoardProvider, BoardRef, Card } from "./types.ts";
import { moveCard } from "./moves.ts";
import { newBoard } from "./rules.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

// The real moves against a plain board; the test answers the tracker's calls, to overlap moves without timing.
function setup() {
  const calls: {
    card: Card;
    ref: BoardRef;
    column: string;
    group?: string;
    reply: ReturnType<typeof deferred<number | void>>;
  }[] = [];
  const provider = { id: "test", groupings: [{ id: "list" }, { id: "status" }] } as unknown as BoardProvider;
  const state = newBoard(provider, { project: "project", board: "board", group: "", view: "" });
  state.cards = [{ id: "1", title: "Card", column: "A", placement: 1, in: { status: "todo" } } as Card];
  const host = {
    board: () => state,
    change: (recipe: (board: typeof state) => void) => recipe(state),
    move: (ref: BoardRef, card: Card, column: string, group?: string) => {
      const reply = deferred<number | void>();
      calls.push({ card, ref, column, group, reply });
      return reply.promise;
    },
    failed: (e: unknown) => String(e),
    queue: new Map<string, Promise<Card>>(),
  };
  const board = { moveCard: (_: BoardProvider, card: Card, column: string) => moveCard(host, provider, card, column) };
  const move = (column: string) => moveCard(host, provider, state.cards[0], column);
  return { board, provider, state, calls, move };
}

test("a second drag waits for the first failure, then becomes the saved position", async () => {
  const { state, calls, move } = setup();
  const first = move("B");
  const second = move("C");
  assert.equal(calls.length, 1, "one request in flight per card");
  calls[0].reply.reject(new Error("B refused"));
  await first;
  assert.equal(calls.length, 2);
  assert.equal(calls[1].column, "C");
  calls[1].reply.resolve(42);
  await second;
  assert.equal(state.cards[0].column, "C");
  assert.equal(state.cards[0].placement, 42);
  assert.equal(state.err, "");
});

test("a later failure restores the preceding successful move including its server placement", async () => {
  const { state, calls, move } = setup();
  const first = move("B");
  const second = move("C");
  calls[0].reply.resolve(17);
  await first;
  calls[1].reply.reject(new Error("C refused"));
  await second;
  assert.equal(state.cards[0].column, "B");
  assert.equal(state.cards[0].placement, 17);
  assert.match(state.err, /C refused/);
});

test("two failed moves restore the original position and release the queue for a retry", async () => {
  const { state, calls, move } = setup();
  const first = move("B");
  const second = move("C");
  calls[0].reply.reject(new Error("B refused"));
  await first;
  calls[1].reply.reject(new Error("C refused"));
  await second;
  assert.equal(state.cards[0].column, "A");
  const retry = move("D");
  assert.equal(calls.length, 3);
  calls[2].reply.resolve();
  await retry;
  assert.equal(state.cards[0].column, "D");
});

test("different cards can move concurrently", async () => {
  const { board, provider, state, calls, move } = setup();
  const other = { ...state.cards[0], id: "2" };
  state.cards.push(other);
  const first = move("B");
  const second = board.moveCard(provider, other, "C");
  assert.equal(calls.length, 2);
  calls[1].reply.resolve();
  await second;
  calls[0].reply.resolve();
  await first;
  assert.equal(state.cards[0].column, "B");
  assert.equal(state.cards[1].column, "C");
});

test("queued moves keep the original board and grouping after navigation", async () => {
  const { state, calls, move } = setup();
  state.group = "status";
  const first = move("doing");
  const second = move("done");
  state.gen++;
  state.board = "other-board";
  state.group = "list";
  const fresh = { ...state.cards[0], column: "fresh" };
  state.cards = [fresh];
  calls[0].reply.resolve();
  await first;
  assert.equal(calls[1].ref.board, "board");
  assert.equal(calls[1].group, "status");
  assert.equal(calls[1].card.in?.status, "done");
  assert.equal(calls[1].card.column, "A");
  calls[1].reply.reject(new Error("Old board refused"));
  await second;
  assert.equal(state.cards[0], fresh);
  assert.equal(state.err, "");
});

test("a reply cannot overwrite a reload of the same board", async () => {
  const { state, calls, move } = setup();
  const pending = move("B");
  state.gen++;
  const fresh = { ...state.cards[0], column: "fresh" };
  state.cards = [fresh];
  calls[0].reply.resolve(42);
  await pending;
  assert.equal(state.cards[0], fresh);
});
