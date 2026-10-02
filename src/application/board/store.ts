import { newBoard, storageKey, type Board } from "../../domain/board/rules";
import type { BoardProvider } from "../../domain/board/types";
import { PROVIDERS } from "../../shared/plugins";
import { storage } from "../../infrastructure/storage";
import { makeStore } from "../make-store";

type BoardState = {
  ready: string[]; // a board row only shows once its integration is switched on and set up, with a token in the keychain
  states: Record<string, Board>; // per provider: what it shows, kept while switching views
  folded: Record<string, string[]>; // per provider: the folded column ids, kept across sessions
  resets: number; // bumped by resetBoard, so a board on screen loads again
};

const storedFolds = (key: string): string[] => {
  try {
    return JSON.parse(storage.getRaw(key) || "[]");
  } catch {
    return [];
  }
};
// a board as far as it is known before the tracker answers: the last project, board and grouping
const storedBoard = (provider: BoardProvider) => {
  const key = storageKey(provider);
  return newBoard(provider, {
    project: storage.getRaw(`${key}Project`),
    board: storage.getRaw(`${key}Board`),
    group: storage.getRaw(`${key}Group`),
  });
};
/** Every provider's board from what was stored, made up front: reading a board never writes. */
export const storedBoards = () => Object.fromEntries(PROVIDERS.map(provider => [provider.id, storedBoard(provider)]));

export const useBoardStore = makeStore<BoardState>(() => ({
  ready: [],
  states: storedBoards(),
  folded: Object.fromEntries(PROVIDERS.map(provider => [provider.id, storedFolds(`${storageKey(provider)}Folded`)])),
  resets: 0,
}));
