import { t } from "../../shared/i18n";
import type { Reminder } from "../../domain/reminders/types";
import * as backend from "../../infrastructure/backend";
import { useWorkspaceStore } from "../workspace/store";
import { loadSnapshot, project } from "../workspace/vault";
import { select } from "../navigation/navigation";
import { newChat } from "../conversations/chats";
import { setTyped } from "../conversations/actions";

// Reminders live in the vault snapshot (`useWorkspaceStore(s => s.snap.reminders)`); these change them through the
// vault's reminder script in the backend, then read the vault again.
const reminders = () => useWorkspaceStore.getState().snap.reminders as Reminder[];

/** Done, or pushed to a date (tomorrow, +1 week, a picked date). */
export async function reminderAction(action: "done" | "push", id: string, date?: string) {
  try {
    await backend.reminder(action, id, date ?? null);
  } catch (err) {
    console.error(err);
  }
  await loadSnapshot();
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
