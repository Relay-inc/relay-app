import { actionSet, doneAction } from "./common.ts";
import type { SubjectDef } from "./types.ts";

export type TimeAct = "book";

/** The day's time to book, from the user's own activity in conversations: from 16:00, when they show 15 minutes or
 *  more. Productive is not asked, the agent finds out what is booked already. */
export const time: SubjectDef<"time", TimeAct> = {
  kinds: { time: { est: 5, rank: 7, icon: "clock" } },
  entries: (snap, w, now) =>
    snap.timeFromSessions && snap.timeMin >= 15 && new Date(now).getHours() >= 16
      ? [
          {
            kind: "time",
            id: `time:${snap.today}`,
            at: now,
            title: w.t("today.timeTitle"),
            where: w.t("today.timeWhere"),
            why: w.t("today.timeWhy", { n: snap.timeMin }),
            tone: "",
            project: null,
            subject: { type: "time", date: snap.today, minutes: snap.timeMin },
          },
        ]
      : [],
  actions: (_entry, _flags, w) =>
    actionSet([{ id: "book", label: w.t("today.timeBook"), icon: "clock", key: "↵" }], 0, null, doneAction(w)),
};
