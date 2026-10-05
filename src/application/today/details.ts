import type { PrDetail } from "../../domain/pull-requests/types";
import type { CardView } from "../../domain/board/types";
import type { Addr, How, Original } from "../../domain/mail/reply";
import { makeStore } from "../make-store";

/** A mail of a thread as the backend's thread tool gives it. */
export type ThreadMail = { id: string; from: Addr[]; date: string; subject: string; untrusted_mail: string };
/** The reply being written under a mail on Today. `text` is Claude's draft once it is in, then the user's. */
export type Compose = {
  key: string; // the mail
  how: How;
  to: Addr[];
  cc: Addr[];
  text: string;
  archive: boolean; // archive the mail once the draft is saved
  busy: "" | "draft" | "tweak" | "save";
  tweak: string;
  err: string;
};
type DetailsState = {
  tab: Record<string, string>; // per item: the tab open in its detail
  pop: "" | "more" | "snooze"; // the open menu
  pr: Record<string, PrDetail>; // per PR key, fetched when its item opens
  card: Record<string, CardView>; // per card key
  thread: Record<string, ThreadMail[]>; // per mail key
  original: Record<string, Original>; // per mail key: what a reply needs
  quick: Record<string, string[]>; // per mail key: Claude's quick replies
  compose: Compose | null;
  picking: string; // the PR (url) whose ticket is being chosen by hand, "" for none
  linking: string; // the PR (url) whose repo or board is being linked on Today, "" for none
  err: Record<string, string>; // per item: why its detail did not load
};
export const useDetailsStore = makeStore<DetailsState>(() => ({
  tab: {},
  pop: "",
  pr: {},
  card: {},
  thread: {},
  original: {},
  quick: {},
  compose: null,
  picking: "",
  linking: "",
  err: {},
}));

/** Open a menu ("more", "snooze"), or close it (""); the same one again closes it. */
export const setPop = (pop: DetailsState["pop"]) =>
  useDetailsStore.setState(draft => {
    draft.pop = draft.pop === pop ? "" : pop;
  });
export const setTab = (id: string, tab: string) =>
  useDetailsStore.setState(draft => {
    draft.tab[id] = tab;
  });
/** Open the ticket picker on a PR (its url), or close it (""). */
export const setPicking = (url: string) =>
  useDetailsStore.setState(draft => {
    draft.picking = url;
  });
/** Open the repo or board linker on a PR (its url), or close it (""). */
export const setLinking = (url: string) =>
  useDetailsStore.setState(draft => {
    draft.linking = url;
  });
