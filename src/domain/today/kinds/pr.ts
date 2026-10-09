import { prsForMe } from "../rules.ts";
import type { PR } from "../../pull-requests/types";
import { byTicket, prNumbers, type PrGroup } from "../../pull-requests/group.ts";
import { actionSet, doneAction, numbered } from "./common.ts";
import type { Draft, Entry, EntryOf, SubjectDef } from "./types.ts";
import type { Translate } from "../../conversations/state";

export type PrAct = "review" | "reviewTogether" | "github" | "inRelay" | "reviewChat" | "findTicket" | "fix";

/** The id of the one item the review PRs of a ticket are, and of their review (a single PR's review is its item's id). */
export const groupId = (provider: string, card: string) => `group:${provider}:${card}`;
/** What the PRs of a ticket are called, in Today's queue and the Pull requests view alike: "#452 Title · 2 PRs". */
export const groupTitle = (group: PrGroup, t: Translate) =>
  group.ticket
    ? `${numbered(group.ticket.number)}${group.ticket.title ?? group.prs[0].title} · ${t("today.prsCount", { n: group.prs.length })}`
    : group.prs[0].title;
/** The review of a group: one per ticket, else the PR's own. */
export const reviewIdOf = (group: PrGroup) =>
  group.ticket ? groupId(group.ticket.provider, group.ticket.card) : `review:${group.prs[0].url}`;
/** A review item that holds the PRs of one ticket: reviewed together. */
export function reviewGroupOf(entry: Entry) {
  const s = entry.subject;
  if (entry.kind !== "review" || s.type !== "pr" || !s.prs || s.prs.length < 2) return null;
  return { id: entry.id, prs: s.prs, title: entry.title };
}

const where = (pr: PR, mine: boolean, yours: string) => `${pr.repo} #${pr.number} · ${mine ? yours : pr.author}`;

/** A pull request: one that asks the user's review ("review"), or the user's own with changes requested or checks
 *  red ("fix"). */
export const pr: SubjectDef<"pr", PrAct> = {
  kinds: {
    review: { est: 15, rank: 6, icon: "pr", bundle: "pr" },
    fix: { est: 20, rank: 7, icon: "pr", bundle: "pr" },
  },
  entries: (snap, w) => {
    const out: Draft[] = [];
    const prs = prsForMe(snap.prs);
    // the PRs of one ticket are one item: reviewed (or fixed) together, planned for the time of all of them
    const title = (group: PrGroup) => groupTitle(group, w.t);
    for (const group of byTicket(prs.review, snap.tickets)) {
      const [pr] = group.prs;
      out.push({
        kind: "review",
        id: reviewIdOf(group),
        at: Math.min(...group.prs.map(x => Date.parse(x.created))),
        title: title(group),
        where: group.ticket
          ? `${prNumbers(group.prs)} · ${[...new Set(group.prs.map(x => x.author))].join(", ")}`
          : where(pr, false, w.t("today.yours")),
        why: w.t("today.reviewAsked"),
        tone: "soon",
        project: pr.project,
        subject: group.ticket ? { type: "pr", pr, prs: group.prs } : { type: "pr", pr },
        times: group.prs.length,
      });
    }
    for (const group of byTicket(prs.mine, snap.tickets)) {
      const [pr] = group.prs;
      out.push({
        kind: "fix",
        id: group.ticket ? `fix:${groupId(group.ticket.provider, group.ticket.card)}` : `fix:${pr.url}`,
        at: Math.max(...group.prs.map(x => Date.parse(x.updated))),
        title: title(group),
        where: group.ticket ? `${prNumbers(group.prs)} · ${w.t("today.yours")}` : where(pr, true, w.t("today.yours")),
        why: group.prs.some(x => x.review === "CHANGES_REQUESTED") ? w.t("rv.changes") : w.t("today.checksRed"),
        tone: "late",
        project: pr.project,
        subject: group.ticket ? { type: "pr", pr, prs: group.prs } : { type: "pr", pr },
        times: group.prs.length,
      });
    }
    return out;
  },
  actions: (entry: EntryOf<"pr">, flags, w) => {
    const github = { id: "github" as const, label: w.t("today.onGithub"), icon: "out", key: "⌫" };
    const inRelay = { id: "inRelay" as const, label: w.t("today.openInPrs"), icon: "pr" };
    const findTicket = { id: "findTicket" as const, label: w.t("today.link.again"), icon: "refresh" };
    if (entry.kind !== "review")
      return actionSet(
        [{ id: "fix", label: w.t("today.fixWithClaude"), key: "↵" }, github, inRelay, findTicket],
        0,
        1,
        doneAction(w),
      );
    // the PRs of the same ticket waiting on your review go together; this one alone stays under "..."
    const group = reviewGroupOf(entry);
    return actionSet(
      [
        group
          ? {
              id: "reviewTogether" as const,
              label: w.t("today.reviewTogether", { n: group.prs.length }),
              key: "↵",
              tip: w.t("today.reviewTogetherTip", { ticket: group.title }),
            }
          : {
              id: "review" as const,
              label: w.t("today.reviewWithClaude", { agent: flags.reviewer }),
              key: "↵",
              tip: w.t("today.reviewTip", { agent: flags.reviewer }),
            },
        github,
        inRelay,
        { id: "reviewChat", label: w.t("today.reviewInChat"), icon: "chat" },
        findTicket,
      ],
      0,
      1,
      doneAction(w, w.t("today.markReviewed")),
    );
  },
};
