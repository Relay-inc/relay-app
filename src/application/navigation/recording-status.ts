import { t } from "../../shared/i18n";
import { WAIT } from "../../domain/navigation/views";
import { useRecordingStore } from "../calendar/recording";
import { useDictationStore } from "../conversations/dictation";
import { usePillStore } from "../conversations/pill";
import { label } from "../conversations/selectors";
import { select } from "./navigation";

/** What Relay is recording, for the row above the sidebar's footer: a meeting (until its transcript is written), the
 *  composer's dictation, or dictation into another app. `open` goes to where it happens; `since` counts the time,
 *  `progress` the transcribing. Null when the microphone is free. */
export type RecordingNow = { label: string; since?: number; progress?: number; open?: () => void } | null;

export function recordingNow(): RecordingNow {
  const meeting = useRecordingStore.getState();
  if (meeting.phase !== "idle") {
    const title = meeting.meeting?.title || t("wait.meetingUntitled");
    return {
      label: title,
      ...(meeting.phase === "saving" ? { progress: meeting.progress } : { since: Date.now() - meeting.secs * 1000 }),
      open: () => select(WAIT),
    };
  }
  const dictation = useDictationStore.getState();
  if (dictation.phase === "recording" || dictation.phase === "transcribing")
    return {
      label: t("rec.dictatingIn", { name: label(dictation.key) }),
      ...(dictation.phase === "recording" ? { since: dictation.startedAt } : {}),
      open: () => select(dictation.key),
    };
  const pill = usePillStore.getState().state.phase;
  if (pill === "recording" || pill === "transcribing") return { label: t("rec.dictatingElsewhere") };
  return null;
}
