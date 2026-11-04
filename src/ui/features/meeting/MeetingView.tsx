import { useEffect, useEffectEvent, useState } from "react";
import { meetingOf } from "../../../domain/navigation/views";
import { notesIn, stepOf, type Step } from "../../../domain/calendar/meeting-view";
import { backToToday, loadMeetingNote, meetingById, stageOf } from "../../../application/calendar/meeting-view";
import { useCalendarStore } from "../../../application/calendar/store";
import { useRecordingStore } from "../../../application/calendar/recording";
import { useNavigationStore } from "../../../application/navigation/store";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { MeetingHeader } from "./MeetingHeader";
import { MeetingBar } from "./MeetingBar";
import { RecordingError } from "./RecordingError";
import { BriefingStep } from "./BriefingStep";
import { LiveStep } from "./LiveStep";
import { WrapupStep } from "./WrapupStep";

/** A meeting as a view of its own (its selection key is `work:meeting:<event id>`): the header, then the step the meeting
 *  is on, or the one picked in the stepper. Esc goes back to Today. */
export function MeetingView({ className = "" }: { className?: string }) {
  const { t } = useT();
  const id = useNavigationStore(s => meetingOf(s.selected));
  const meeting = useDerived(() => meetingById(id));
  const stage = useDerived(() => stageOf(id));
  const recording = useRecordingStore(s => s.phase === "recording" && s.meeting?.id === id);
  const saving = useRecordingStore(s => s.phase === "saving" && s.meeting?.id === id);
  const note = useCalendarStore(s => (s.note?.id === id ? s.note : null));
  const looked = useCalendarStore(s => s.noted === id);

  const load = useEffectEvent((again: boolean) => {
    const found = meetingById(id);
    if (found) void loadMeetingNote(found, again);
  });
  useEffect(() => load(false), [id]);
  // the recorder writes the language into the note once it knows it: look again now and then while it listens
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => load(true), 5000);
    return () => clearInterval(timer);
  }, [recording]);

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    const typing = e
      .composedPath()
      .some(n => n instanceof HTMLElement && n.matches("input, textarea, select, [contenteditable]"));
    if (e.key === "Escape" && !typing && !e.defaultPrevented) {
      e.preventDefault();
      backToToday();
    }
  });
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  // the step the meeting is on, until one is picked; it is the meeting's again when its stage moves on
  const reached = stepOf(stage, saving);
  const [pick, setPick] = useState<{ reached: Step; step: Step | null }>({ reached, step: null });
  if (pick.reached !== reached) setPick({ reached, step: null });
  const step = pick.step ?? reached;

  if (!meeting)
    return (
      <div className={`${className} flex flex-col items-center justify-center gap-3 text-secondary`}>
        <span className="text-[15px] text-label font-semibold">{t("meet.gone")}</span>
        <button className="btn cursor-pointer" onClick={backToToday}>
          {t("today.backToToday")}
        </button>
      </div>
    );
  return (
    <div className={`${className} flex flex-col min-h-0`}>
      <MeetingBar meeting={meeting} note={note} />
      <RecordingError />
      <MeetingHeader
        meeting={meeting}
        noteText={note?.text ?? null}
        step={step}
        reached={reached}
        showJoin={step === "live"}
        onStep={next => setPick({ reached, step: next })}
      />
      {step === "briefing" ? (
        <BriefingStep meeting={meeting} note={note} onStart={() => setPick({ reached, step: "live" })} />
      ) : step === "live" ? (
        // the editor is made from the note once it has been looked for
        looked ? (
          <LiveStep meeting={meeting} notes={note ? (notesIn(note.text) ?? "") : ""} noteText={note?.text ?? ""} />
        ) : null
      ) : (
        <WrapupStep note={note} />
      )}
    </div>
  );
}
