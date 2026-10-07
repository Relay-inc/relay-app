import { actionSet } from "./common.ts";
import type { SubjectDef } from "./types.ts";

export type ReminderAct = "done" | "tomorrow" | "week" | "chat";

/** A reminder of the vault that is due. */
export const reminder: SubjectDef<"reminder", ReminderAct> = {
  kinds: { reminder: { est: 15, rank: 4, icon: "list" } },
  entries: (snap, w) =>
    snap.reminders
      .filter(reminder => reminder.days <= 0)
      .map(reminder => {
        const late = reminder.days < 0;
        return {
          kind: "reminder",
          late,
          id: `rem:${reminder.id}`,
          at: Date.parse(reminder.date),
          title: reminder.title,
          where: w.t("nav.reminders"),
          why: late ? w.t("today.daysLate", { n: -reminder.days }) : w.t("rem.today"),
          tone: late ? "late" : "soon",
          project: reminder.project,
          subject: { type: "reminder", reminder },
        };
      }),
  actions: (_entry, _flags, w) =>
    actionSet(
      [
        { id: "done", label: w.t("rem.done"), icon: "check", key: "↵" },
        { id: "tomorrow", label: w.t("rem.tomorrow"), key: "⌫" },
        { id: "week", label: w.t("rem.plusWeek") },
        { id: "chat", label: w.t("today.askClaude"), icon: "chat" },
      ],
      0,
      1,
    ),
};
