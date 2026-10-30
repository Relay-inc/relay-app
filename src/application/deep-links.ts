import { parseLink, unhandled } from "../domain/navigation/deep-links";
import * as backend from "../infrastructure/backend";
import { session } from "../infrastructure/storage";
import { isActive, isPrimary } from "../infrastructure/window";
import { openProject, quickProjects, toast, toggleQuickAsk } from "./navigation/navigation";
import { meetingChat } from "./calendar/calendar";
import { useCalendarStore } from "./calendar/store";
import { startRecording } from "./calendar/recording";
import { t } from "../shared/i18n";

/** A relay:// link from outside the app (Raycast, a launcher, any web page). Deliberately unlike Lit, which sent
 *  `ask?q=` at once: an ask link only opens Cmd-K with its question typed, and nothing goes to an agent until the user
 *  presses Enter there (where a matching project can be picked as always). */
function handleLink(link: string) {
  const parsed = parseLink(link);
  if (parsed?.kind === "ask") toggleQuickAsk(true, parsed.text);
  else if (parsed?.kind === "open") {
    const [best] = quickProjects(parsed.query);
    if (best) openProject(best.name);
    else toggleQuickAsk(true);
  } else if (parsed?.kind === "meeting") {
    // Relay's own copy when the calendar has it, else the meeting as the link gives it; the toast's button starts it
    const meeting = useCalendarStore.getState().list.find(x => x.id === parsed.meeting.id) ?? parsed.meeting;
    const acts: Record<typeof parsed.act, [() => unknown, string]> = {
      prep: [() => meetingChat(meeting.id, "prep", meeting), t("wait.meetingPrep")],
      record: [() => startRecording(meeting.id, meeting), t("rec.record")],
      note: [() => meetingChat(meeting.id, "note", meeting), t("today.makeNote")],
    };
    const [run, label] = acts[parsed.act];
    toast(meeting.title || t("wait.meetingUntitled"), () => void run(), label, 30000);
  }
}

// a webview reload boots again and the launch links come back: the ones handled in this app launch are remembered
const HANDLED = "handledLinks";
function handleOnce(link: string) {
  session.set(HANDLED, [...session.get<string[]>(HANDLED, []), link]);
  handleLink(link);
}
/** The link that launched the app, once per launch (in the main window), then every one opened later (in the active
 *  window, which the backend brought up). */
export async function listenToLinks() {
  if (isPrimary()) unhandled(await backend.launchLinks(), session.get<string[]>(HANDLED, [])).forEach(handleOnce);
  backend.onDeepLink(link => isActive() && handleOnce(link));
}
