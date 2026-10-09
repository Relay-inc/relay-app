import type { PR } from "./types";

/** The ticket a PR is about, as the links store keeps it. */
export type PrTicket = { provider?: string; card?: string; number?: string; title?: string };
/** PRs shown as one: the PRs of one ticket (`ticket` set), or a single PR. */
export type PrGroup = { key: string; ticket?: PrTicket & { provider: string; card: string }; prs: PR[] };

/** The PRs of one ticket together, at the place of the first of them; a PR without a ticket, or alone on its ticket,
 *  stays on its own. Today's queue and the Pull requests view group by this one rule. */
export function byTicket(prs: PR[], tickets: Record<string, PrTicket | undefined>): PrGroup[] {
  const groups = new Map<string, PR[]>();
  for (const pr of prs) {
    const link = tickets[pr.url];
    const key = link?.card && link.provider ? `${link.provider}:${link.card}` : pr.url;
    groups.set(key, [...(groups.get(key) ?? []), pr]);
  }
  return [...groups].map(([key, group]) => {
    const link = tickets[group[0].url];
    return group.length > 1 && link?.provider && link.card
      ? { key, ticket: { ...link, provider: link.provider, card: link.card }, prs: group }
      : { key: group[0].url, prs: group };
  });
}

/** Where the PRs of a group live: "acme/app #7, #8", or "acme/app #7, acme/api #8" across repos. */
export const prNumbers = (prs: PR[]) =>
  prs.map((pr, i) => (i && pr.repo === prs[i - 1].repo ? `#${pr.number}` : `${pr.repo} #${pr.number}`)).join(", ");
