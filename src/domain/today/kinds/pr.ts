import { prsForMe } from "../rules.ts";
import type { PR } from "../../pull-requests/types";
import { actionSet, doneAction, numbered } from "./common.ts";
import type { Draft, Entry, EntryOf, SubjectDef, Ticket } from "./types.ts";

export type PrAct = "review" | "reviewTogether" | "github" | "inRelay" | "reviewChat" | "findTicket" | "fix";

/** The id of the one item the review PRs of a ticket are, and of their review (a single PR's review is its item's id). */
export const groupId = (provider: string, card: string) => `group:${provider}:${card}`;
/** A review item that holds the PRs of one ticket: reviewed together. */
export function reviewGroupOf(entry: Entry) {
  const s = entry.subject;
  if (s.type !== "pr" || !s.prs || s.prs.length < 2) return null;
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
    // the review PRs of one ticket are one item: reviewed together, planned for the time of all of them
    const byTicket = new Map<string, PR[]>();
    for (const pr of prs.review) {
      const link: Ticket | undefined = snap.tickets[pr.url];
      const key = link?.card && link.provider ? groupId(link.provider, link.card) : `review:${pr.url}`;
      byTicket.set(key, [...(byTicket.get(key) ?? []), pr]);
    }
    for (const [id, group] of byTicket) {
      const [pr] = group;
      const link = group.length > 1 ? snap.tickets[pr.url] : undefined;
      out.push({
        kind: "review",
        id: link ? id : `review:${pr.url}`,
        at: Math.min(...group.map(x => Date.parse(x.created))),
        title: link
          ? `${numbered(link.number)}${link.title ?? pr.title} · ${w.t("today.prsCount", { n: group.length })}`
          : pr.title,
        where: link
          ? `${pr.repo} ${group.map(x => `#${x.number}`).join(", ")} · ${[...new Set(group.map(x => x.author))].join(", ")}`
          : where(pr, false, w.t("today.yours")),
        why: w.t("today.reviewAsked"),
        tone: "soon",
        project: pr.project,
        subject: link ? { type: "pr", pr, prs: group } : { type: "pr", pr },
        times: group.length,
      });
    }
    for (const pr of prs.mine)
      out.push({
        kind: "fix",
        id: `fix:${pr.url}`,
        at: Date.parse(pr.updated),
        title: pr.title,
        where: where(pr, true, w.t("today.yours")),
        why: pr.review === "CHANGES_REQUESTED" ? w.t("rv.changes") : w.t("today.checksRed"),
        tone: "late",
        project: pr.project,
        subject: { type: "pr", pr },
      });
    return out;
  },
  actions: (entry: EntryOf<"pr">, _flags, w) => {
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
          : { id: "review" as const, label: w.t("today.reviewWithClaude"), key: "↵", tip: w.t("today.reviewTip") },
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
