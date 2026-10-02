import type { ReminderDraft } from "../../domain/reminders/types";
import { todayIso } from "../../domain/reminders/rules";
import { addReminder } from "./reminders";
import { useRemindersStore } from "./store";

// The new-reminder form (application/reminders/store.ts): what is typed, and the add while it runs.
const draft = () => useRemindersStore.getState().draft;
export const patchDraft = (changes: Partial<ReminderDraft>) =>
  useRemindersStore.setState(state => {
    Object.assign(state.draft, changes);
  });
/** Open the form (the title bar's "New reminder"), dated tomorrow unless a date was picked before. The draft lives in
 *  the store, so the view need not be mounted yet. */
export const openReminderForm = () => patchDraft({ open: true, date: draft().date || todayIso(1) });
export const closeDraft = () => patchDraft({ open: false, err: "" });
/** Add what the form holds: on success the form empties and closes, on a failure it keeps the text and says why. */
export async function addDraft() {
  const { text, date, project, repeat, busy } = draft();
  if (!text.trim() || !date || busy) return;
  patchDraft({ busy: true, err: "" });
  try {
    await addReminder(text.trim(), date, project || null, repeat || null);
    patchDraft({ open: false, text: "", date: "", project: "", repeat: "" });
  } catch (e) {
    patchDraft({ err: String(e) });
  }
  patchDraft({ busy: false });
}
