import { t } from "../../shared/i18n";
import type { Reminder } from "../../domain/reminders/types";
import * as backend from "../../infrastructure/backend";
import { useWorkspaceStore } from "../workspace/store";
import { loadSnapshot, project } from "../workspace/vault";
import { select, toast } from "../navigation/navigation";
import { newChat } from "../conversations/chats";
import { setTyped } from "../conversations/actions";
import { contextTint } from "../navigation/sidebar";

// Reminders live in the vault snapshot (`useWorkspaceStore(s => s.snap.reminders)`); these change them through the
// vault's reminder script in the backend, then read the vault again.
const reminders = () => useWorkspaceStore.getState().snap.reminders as Reminder[];

async function act(action: "done" | "push", id: string, date?: string) {
  try {
    await backend.reminder(action, id, date ?? null);
  } catch (err) {
    console.error(err);
  }
  await loadSnapshot();
}
const TOASTS = { morgen: "rem.toastTomorrow", "+1w": "rem.toastWeek" } as const;
/** Done, or pushed to a date (tomorrow, +1 week, a picked date); the toast after it can undo it. Never throws: a
 *  failure is logged and the vault read again. */
export async function reminderAction(reminder: Reminder, action: "done" | "push", date?: string) {
  await act(action, reminder.id, date);
  const text =
    action === "done" ? "rem.toastDone" : (TOASTS[date as keyof typeof TOASTS] ?? ("rem.toastMoved" as const));
  toast(t(text, { text: reminder.title }), () => void undo(reminder));
}
// back to the date it had: a repeating reminder is pushed back, a finished one is written again
async function undo(reminder: Reminder) {
  const moved = reminders().find(x => x.text === reminder.text && x.date !== reminder.date);
  if (moved) await act("push", moved.id, reminder.date);
  else if (!reminders().some(x => x.id === reminder.id))
    await addReminder(reminder.text, reminder.date, null, reminder.repeat).catch(console.error);
}
/** A new reminder; throws what the backend said, so the form keeps what was typed. */
export async function addReminder(text: string, date: string, projectName: string | null, repeat: string | null) {
  await backend.reminderAdd(text, date, projectName, repeat);
  await loadSnapshot();
}
/** A new conversation with the whole reminder in the composer, one Enter away from sending. */
export async function chatAboutReminder(id: string) {
  const reminder = reminders().find(x => x.id === id);
  if (!reminder) return;
  await select(newChat(project(reminder.project) ? reminder.project : null));
  setTyped(t("rem.chatText", { date: reminder.date, text: reminder.text }));
}
/** The colour of a project's context ("" for no project), as the sidebar shows it. */
export const projectTint = (name: string | null) => {
  const context = project(name)?.context;
  return context ? contextTint(context) : "";
};
