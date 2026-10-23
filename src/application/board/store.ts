import { newBoard, storageKey, type Board } from "../../domain/board/rules";
import type { BoardProvider } from "../../domain/board/types";
import { PROVIDERS } from "../../shared/plugins";
import { storage } from "../../infrastructure/storage";
import { makeStore } from "../make-store";

type BoardState = {
  ready: string[]; // a board row only shows once its integration is switched on and set up, with a token in the keychain
  states: Record<string, Board>; // per provider: what it shows, kept while switching views
  folded: Record<string, Record<string, boolean>>; // per provider: folded or open, per column id the user clicked
  resets: number; // bumped by resetBoard, so a board on screen loads again
  composing: { provider: string; column: string } | null; // the New task dialog, for a column of that provider's board
  ticketChats: Record<string, string[]>; // per card key: the conversations Start conversation began from it
};

const storedFolds = (key: string): Record<string, boolean> => {
  try {
    return JSON.parse(storage.getRaw(key) || "{}") || {};
  } catch {
    return {};
  }
};
/** A provider's board as far as it is known before the tracker answers: the last project, board, grouping and layout.
 *  `gen` goes on from the board it replaces (resetBoard). */
export const storedBoard = (provider: BoardProvider, gen = 0) => {
  const key = storageKey(provider);
  return newBoard(
    provider,
    {
      project: storage.getRaw(`${key}Project`),
      board: storage.getRaw(`${key}Board`),
      group: storage.getRaw(`${key}Group`),
      view: storage.getRaw(`${key}View`),
    },
    gen,
  );
};

export const useBoardStore = makeStore<BoardState>(() => ({
  ready: [],
  // every provider's board made up front: reading a board never writes
  states: Object.fromEntries(PROVIDERS.map(provider => [provider.id, storedBoard(provider)])),
  folded: Object.fromEntries(PROVIDERS.map(provider => [provider.id, storedFolds(`${storageKey(provider)}Fold`)])),
  resets: 0,
  composing: null,
  ticketChats: storage.get<Record<string, string[]>>("ticketChats", {}),
}));
// started in another Relay window
storage.watch("ticketChats", () =>
  useBoardStore.setState(draft => {
    draft.ticketChats = storage.get<Record<string, string[]>>("ticketChats", {});
  }),
);
