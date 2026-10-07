import { DAY, actionSet, doneAction, numbered } from "./common.ts";
import type { SubjectDef } from "./types.ts";

export type CardAct = "start" | "openIn" | "chat" | "open";

/** A card of the user's on a linked board: due today or earlier, or in progress. */
export const card: SubjectDef<"card", CardAct> = {
  kinds: { card: { est: 30, rank: 4, icon: "board" } },
  // a card's status is its tracker's
  state: subject => subject.card.card.state,
  entries: (snap, w, now) =>
    snap.cards.map(item => {
      const daysLate = (date: string) => Math.round((Date.parse(snap.today) - Date.parse(date)) / DAY);
      const late = !!item.card.due && daysLate(item.card.due) > 0;
      return {
        kind: "card",
        late,
        id: `card:${item.provider}:${item.card.id}`,
        at: item.card.due ? Date.parse(item.card.due) : now,
        title: `${numbered(item.card.number)}${item.card.title}`,
        where: snap.trackers[item.provider] ?? "",
        why: late
          ? w.t("today.daysLate", { n: daysLate(item.card.due!) })
          : item.card.due
            ? w.t("rem.today")
            : item.card.status || w.t("today.inProgress"),
        tone: late ? "late" : "soon",
        project: item.project,
        subject: { type: "card", card: item },
      };
    }),
  actions: (entry, flags, w) =>
    actionSet(
      [
        { id: "start", label: w.t("today.startWorking"), icon: "right", key: "↵", tip: w.t("today.startWorkingTip") },
        {
          id: "openIn",
          label: w.t("kb.openIn", { name: flags.trackers[entry.subject.card.provider] ?? "" }),
          icon: "out",
          key: "⌫",
        },
        { id: "chat", label: w.t("today.askClaude"), icon: "chat" },
        { id: "open", label: w.t("today.openTicket"), icon: "board" },
      ],
      0,
      1,
      doneAction(w),
    ),
};
