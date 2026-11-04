import { joinable } from "../../calendar/rules.ts";
import { actionSet, doneAction } from "./common.ts";
import type { SubjectDef } from "./types.ts";

export type MeetingAct = "prep" | "join" | "record" | "makeNote" | "noNote";

/** A meeting of today. It has no items in the queue any more (see `entries`); its kinds and actions stay for the ones
 *  that were opened before. */
export const meeting: SubjectDef<"meeting", MeetingAct> = {
  kinds: {
    prep: { est: 10, rank: 1, icon: "cal" },
    note: { est: 10, rank: 5, icon: "cal" },
  },
  // the meetings are not in the queue: the day strip, the card above it and the wrap-ups owed carry them (ui/features/today)
  entries: () => [],
  actions: (entry, _flags, w) => {
    if (entry.kind === "note")
      return actionSet(
        [
          { id: "makeNote", label: w.t("today.makeNote"), icon: "notes", key: "↵" },
          { id: "noNote", label: w.t("today.noNote"), key: "⌫" },
        ],
        0,
        1,
      );
    const join = joinable(entry.subject.meeting.join);
    return actionSet(
      [
        { id: "prep", label: w.t("wait.meetingPrep"), icon: "chat", key: "↵" },
        ...(join ? [{ id: "join" as const, label: w.t("wait.meetingJoin"), icon: "video", key: "⌫" }] : []),
        { id: "record", label: w.t("rec.record"), icon: "mic", tip: w.t("rec.recordHelp") },
      ],
      0,
      join ? 1 : null,
      doneAction(w, w.t("today.prepared")),
    );
  },
};
