import { joinable } from "../../calendar/rules.ts";
import { DAY, MIN, actionSet, doneAction, startOfDay } from "./common.ts";
import type { Draft, SubjectDef } from "./types.ts";

export type MeetingAct = "prep" | "join" | "record" | "makeNote" | "noNote";

/** A meeting of today: its prep until it ends (while it runs a click still opens its briefing), then its note. */
export const meeting: SubjectDef<"meeting", MeetingAct> = {
  kinds: {
    prep: { est: 10, rank: 1, icon: "cal" },
    note: { est: 10, rank: 5, icon: "cal" },
  },
  entries: (snap, w, now) => {
    const out: Draft[] = [];
    const midnight = startOfDay(now);
    for (const meeting of snap.meetings) {
      const start = Date.parse(meeting.start);
      const end = Date.parse(meeting.end);
      if (start < midnight || start >= midnight + DAY) continue;
      const base = {
        project: snap.meetingProject[meeting.id] ?? null,
        subject: { type: "meeting", meeting } as const,
      };
      const when = `${w.clock(meeting.start)}–${w.clock(meeting.end)}`;
      const where = [when, meeting.location].filter(Boolean).join(" · ");
      const title = meeting.title || w.t("wait.meetingUntitled");
      if (end > now)
        out.push({
          ...base,
          kind: "prep",
          id: `prep:${meeting.id}`,
          at: start,
          by: start,
          title: w.t("today.prepTitle", { title }),
          where,
          why:
            start > now
              ? w.t("today.starts", { time: w.clock(meeting.start) })
              : `${w.t("wait.meetingNow")} · ${w.t("today.until", { time: w.clock(meeting.end) })}`,
          tone: start - now < 60 * MIN ? "soon" : "",
        });
      else
        out.push({
          ...base,
          kind: "note",
          id: `note:${meeting.id}`,
          at: end,
          title: w.t("today.noteTitle", { title }),
          where,
          why: w.t("today.ended", { time: w.clock(meeting.end) }),
          tone: "",
        });
    }
    return out;
  },
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
        ...(join ? [{ id: "join" as const, label: w.t("wait.meetingJoin"), key: "⌫" }] : []),
        { id: "record", label: w.t("rec.record"), tip: w.t("rec.recordHelp") },
      ],
      0,
      join ? 1 : null,
      doneAction(w, w.t("today.prepared")),
    );
  },
};
