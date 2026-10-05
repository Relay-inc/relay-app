import type { TodayCard } from "../../domain/today/rules";
import { makeStore } from "../make-store";

type TodayState = {
  cards: TodayCard[]; // the user's cards for today, from every board linked to a vault project
  errors: string[]; // per board that did not load
  at: number; // when the cards last arrived, ms; 0 before that
};

export const useTodayStore = makeStore<TodayState>(() => ({ cards: [], errors: [], at: 0 }));
