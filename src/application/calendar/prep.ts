import { briefingIn } from "../../domain/calendar/rules";
import { mergePrep, prepState } from "../../domain/calendar/briefing";
import type { Meeting } from "../../domain/calendar/types";
import { clearPrep } from "../conversations/chats";
import { useConversationsStore } from "../conversations/store";
import { meetingNote } from "./calendar";
import { saveBriefing } from "./meeting-view";
import { recordWrite } from "../navigation/changes";
import { t } from "../../shared/i18n";

// A prep rewrites the briefing, and Claude may drop what is the user's in it. What the user owns (their points, the
// steps they ticked) is kept with the prep's conversation when it starts, and put back into the briefing when its turn
// ends, wherever the user is, once the briefing differs from the old one (a turn that wrote nothing waits); after a restart a prep still waiting is merged at start. Once it has been put back (or
// there was no briefing to put it in) the snapshot goes.

/** Puts the prep's snapshot back into the briefing its conversation (`key`) wrote. When the note cannot be read or was
 *  changed in between, the snapshot stays for the next time. */
export async function finishPrep(key: string, atStart = false) {
  const run = useConversationsStore.getState().chats[key]?.prep;
  if (!run) return;
  const meeting: Meeting = {
    id: run.meeting.id,
    feed: "",
    title: run.meeting.title,
    start: run.meeting.start,
    end: run.meeting.start,
    location: "",
    join: "",
    organizer: "",
    people: [],
  };
  try {
    const note = await meetingNote(meeting);
    const now = note ? briefingIn(note.text) : null;
    // the briefing is still the one the prep was asked about: it has not written yet, the snapshot waits for its next turn
    const state = prepState(run, now);
    if (state === "wait" && !atStart) return; // at start the prep is dead: nothing more will be written
    const owned = run.points.length > 0 || run.ticked.length > 0; // nothing of the user's to put back: the prep's own text stands
    const merged = state === "merge" && now !== null && owned ? mergePrep(run, now) : null;
    let after = note?.text ?? null;
    if (merged !== null && merged !== now) after = (await saveBriefing(meeting, merged))?.text ?? after;
    // the prep's write, as one entry of the Changes feed: the note as it was when the prep started against the note now
    if (state === "merge" && note && after !== null && run.before !== undefined)
      await recordWrite("prep", run.meeting.title, t("changes.reasonPrep", { title: run.meeting.title }), [
        { path: note.path, before: run.before, after },
      ]);
  } catch {
    return;
  }
  clearPrep(key);
}
/** At start: the preps that were still waiting when the app closed. */
export function finishPendingPreps() {
  for (const chat of Object.values(useConversationsStore.getState().chats))
    if (chat.prep) void finishPrep(chat.key, true);
}
