import type { Related } from "../../domain/related/rules";
import { makeStore } from "../make-store";

type RelatedState = {
  hits: Record<string, Related[]>; // by conversation key
  asked: Record<string, number>; // the message count last asked for
};

export const useRelatedStore = makeStore<RelatedState>(() => ({ hits: {}, asked: {} }));
