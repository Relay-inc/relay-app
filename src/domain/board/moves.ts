import type { BoardProvider, BoardRef, Card } from "./types";
import { colOf, endOf, refOf, withCol, type Board } from "./rules.ts";

/** What a move needs from the application: the provider's board as it is now, a way to change it, the call to the
 *  tracker, the message for a failure, and the moves in flight per card. */
export type MoveHost = {
  board: () => Board;
  change: (recipe: (board: Board) => void) => void;
  move: (ref: BoardRef, card: Card, column: string, group?: string) => Promise<number | void>;
  failed: (e: unknown) => string;
  queue: Map<string, Promise<Card>>;
};

/** A card to another column. Moves of one card reach the tracker in order: each waits for the one before and starts
 *  from the card that one confirmed, so a failed move rolls back to that position, even when the one before failed too.
 *  The move in flight shows at once (at the end of its column); different cards move independently. Navigation, a
 *  reload or a reset (a newer `gen`) means a late answer no longer touches the board. */
export async function moveCard(host: MoveHost, provider: BoardProvider, card: Card, column: string) {
  const state = host.board();
  const ref = refOf(provider, state);
  const { group, gen } = state;
  const placement = endOf(provider, state, column, card.id);
  const key = JSON.stringify([provider.id, ref.project, ref.board, card.id]);
  const previous = host.queue.get(key);
  let finish!: (confirmed: Card) => void;
  const done = new Promise<Card>(resolve => {
    finish = resolve;
  });
  host.queue.set(key, done);
  let confirmed = previous ? await previous : card;
  const live = () => {
    const now = host.board();
    return now.gen === gen && now.project === ref.project && now.board === ref.board && now.group === group;
  };
  const change = (recipe: (board: Board) => void) => {
    if (live()) host.change(recipe);
  };
  const replace = (next: Card) =>
    change(board => {
      board.cards = board.cards.map(x => (x.id === card.id ? next : x));
    });
  try {
    if (column === colOf(provider, { group }, confirmed)) return;
    const moved = { ...withCol(provider, { group }, confirmed, column), placement };
    replace(moved);
    change(board => {
      board.err = "";
    });
    const actual = await host.move(ref, moved, column, group || undefined);
    confirmed = actual == null ? moved : { ...moved, placement: actual };
    replace(confirmed);
  } catch (e) {
    replace(confirmed);
    change(board => {
      board.err = host.failed(e);
    });
  } finally {
    finish(confirmed);
    if (host.queue.get(key) === done) host.queue.delete(key);
  }
}
