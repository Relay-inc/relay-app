import { briefingIn } from "../../domain/calendar/rules";
import { mergePrep } from "../../domain/calendar/briefing";
import type { Meeting } from "../../domain/calendar/types";
import { clearPrep } from "../conversations/chats";
import { useConversationsStore } from "../conversations/store";
import { meetingNote } from "./calendar";
import { saveBriefing } from "./meeting-view";

// A prep rewrites the briefing, and Claude may drop what is the user's in it. What the user owns (their points, the
// steps they ticked) is kept with the prep's conversation when it starts, and put back into the briefing when its turn
// ends, wherever the user is; after a restart a prep still waiting is merged at start. Once it has been put back (or
// there was no briefing to put it in) the snapshot goes.

/** Puts the prep's snapshot back into the briefing its conversation (`key`) wrote. When the note cannot be read or was
 *  changed in between, the snapshot stays for the next time. */
export async function finishPrep(key: string) {
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
    const merged = now === null ? null : mergePrep(run, now);
    if (merged !== null && merged !== now) await saveBriefing(meeting, merged);
  } catch {
    return;
  }
  clearPrep(key);
}
/** At start: the preps that were still waiting when the app closed. */
export function finishPendingPreps() {
  for (const chat of Object.values(useConversationsStore.getState().chats)) if (chat.prep) void finishPrep(chat.key);
}
