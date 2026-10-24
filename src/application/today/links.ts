import { provider } from "../../shared/plugins";
import { fill, prompts, untrusted, untrustedNote } from "../../shared/prompts";
import { byNumber, byTitle, type Candidate } from "../../domain/today/link";
import type { PR } from "../../domain/pull-requests/types";
import * as backend from "../../infrastructure/backend";
import { storage } from "../../infrastructure/storage";
import { isPrimary } from "../../infrastructure/window";
import { makeStore } from "../make-store";
import { usePullRequestsStore } from "../pull-requests/store";
import { useTodayStore } from "./store";

// Which ticket a pull request is about, kept in Relay's own store (ui-state.json, `prTickets`) so each PR is worked
// out once: a ticket number in its title or branch, else a title like one card's, else Claude picks one from its
// project's board (one call without tools, at most a few per round). "none" is kept too and tried again after a few
// days; what the user unlinked by hand stays unlinked.

export type Link = {
  at: number; // when it was worked out, ms
  how: "number" | "title" | "ai" | "picked" | "none" | "manual"; // picked: chosen by the user; manual: no ticket, the user said
  provider?: string;
  card?: string; // the card's id in its tracker
  number?: string;
  title?: string;
};
const KEY = "prTickets";
export const useLinksStore = makeStore<{ links: Record<string, Link> }>(() => ({ links: storage.get(KEY, {}) }));
storage.watch(KEY, () =>
  useLinksStore.setState(draft => {
    draft.links = storage.get(KEY, {});
  }),
);
const keep = (url: string, link: Link) => {
  useLinksStore.setState(draft => {
    draft.links[url] = link;
  });
  storage.set(KEY, useLinksStore.getState().links);
};

const RETRY = 3 * 86_400_000; // a PR without a ticket is looked at again after three days: the board may have one now
const AI_PER_ROUND = 5;
let running = false;
/** Work out the ticket of every open PR that does not have one yet. Runs after the boards' cards come in. */
export async function linkPrs() {
  const list = usePullRequestsStore.getState().list;
  if (running || !list || !isPrimary()) return; // the main window works them out, the others follow its store
  running = true;
  let ai = AI_PER_ROUND;
  try {
    for (const pr of [...new Map([...list.review, ...list.mine].map(pr => [pr.url, pr])).values()]) {
      const known = useLinksStore.getState().links[pr.url];
      if (known && (known.how !== "none" || Date.now() - known.at < RETRY)) continue;
      const result = await linkOne(pr, ai > 0);
      if (result === "ai") ai--;
    }
  } finally {
    running = false;
  }
}
/** Find a PR's ticket again (the "…" menu): what was found before, or unlinked by hand, is forgotten first, and Claude
 *  may be asked. Resolves with the link it found, null for none or for a project without a board. */
export async function relinkPr(pr: PR) {
  useLinksStore.setState(draft => {
    delete draft.links[pr.url];
  });
  storage.set(KEY, useLinksStore.getState().links);
  await linkOne(pr, true);
  return ticketOf(pr.url);
}
// one PR: by number, by title, else (when allowed) Claude; kept unless no board or no call was allowed
async function linkOne(pr: PR, allowAi: boolean): Promise<"number" | "title" | "ai" | "skipped"> {
  const board = pr.project ? useTodayStore.getState().boards[pr.project] : undefined;
  if (!board) return "skipped";
  const cards: Candidate[] = board.cards.map(card => ({ id: card.id, number: card.number, title: card.title }));
  const number = byNumber(pr, cards);
  const title = number ? null : byTitle(pr.title, cards);
  if (!number && !title && !allowAi) return "skipped";
  const found = number ?? title ?? (await askClaude(pr, cards));
  const how = number ? "number" : title ? "title" : "ai";
  keep(
    pr.url,
    found
      ? { at: Date.now(), how, provider: board.provider, card: found.id, number: found.number, title: found.title }
      : { at: Date.now(), how: "none" },
  );
  return how;
}

// Claude picks the card from the list, or none; what it answers counts only when it is a number on the list
async function askClaude(pr: PR, cards: Candidate[]): Promise<Candidate | null> {
  const list = cards
    .filter(card => card.number)
    .slice(0, 150)
    .map(card => `${card.number}: ${card.title}`)
    .join("\n");
  if (!list) return null;
  try {
    const answer = await backend.aiWrite(
      fill(prompts.pullRequests.linkTicket, { untrusted: untrustedNote("nl", ["pull_request", "tickets"]) }),
      `${untrusted("pull_request", `Titel: ${pr.title}\nBranch: ${pr.branch ?? ""}\nRepo: ${pr.repo}`)}\n\n${untrusted("tickets", list)}`,
    );
    const said = answer.trim().replace(/^#/, "").split(/\s/)[0].toLowerCase();
    return cards.find(card => card.number.replace(/^#/, "").toLowerCase() === said) ?? null;
  } catch {
    return null;
  }
}

/** The ticket a PR is about, when one was found. */
export const ticketOf = (url: string) => {
  const link = useLinksStore.getState().links[url];
  return link?.card ? link : null;
};
/** The PRs about a card. */
export const prsOfCard = (providerId: string, card: string) =>
  Object.entries(useLinksStore.getState().links)
    .filter(([, link]) => link.provider === providerId && link.card === card)
    .map(([url]) => url);
/** The ticket the user chose for a PR (the picker): kept like a found one, never worked out again. */
export const chooseTicket = (url: string, providerId: string, card: { id: string; number: string; title: string }) =>
  keep(url, {
    at: Date.now(),
    how: "picked",
    provider: providerId,
    card: card.id,
    number: card.number,
    title: card.title,
  });
/** Why a PR has no ticket, so Today can offer the fix: its repo has no vault project, the project no linked board, or
 *  nothing on the board fits (yet). */
export function ticketState(pr: PR): "linked" | "noProject" | "noBoard" | "none" {
  if (ticketOf(pr.url)) return "linked";
  if (!pr.project) return "noProject";
  if (!useTodayStore.getState().boards[pr.project]) return "noBoard";
  return "none";
}
/** "Not this ticket": the PR stays without one, also next time. */
export const unlinkPr = (url: string) => keep(url, { at: Date.now(), how: "manual" });
/** The tracker of a link, for its name. */
export const trackerOfLink = (link: Link) => (link.provider ? provider(link.provider) : undefined);
