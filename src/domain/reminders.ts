import { invoke } from "@tauri-apps/api/core";
import { t } from "../core/i18n";
import { vault, loadSnapshot, project } from "./vault";
import { newChat } from "./chats/state";
import { setTyped } from "./chats/actions";
import { select } from "./navigation";

// Reminders from the vault (the reminders file in the snapshot). Done, tomorrow, +1 week and a date go through the
// vault's reminder script in the backend; a reminder can also start a conversation.
export type Reminder = { id: string; date: string; days: number; project: string | null; title: string; text: string; repeat: string | null };
export const reminders = () => vault.snap.reminders as Reminder[];
/** red when overdue, orange today and in the next 2 days, grey after that (decided 29/9) */
export const urgency = (days: number): "late" | "soon" | "" => days < 0 ? "late" : days <= 2 ? "soon" : "";

export async function remAct(action: "done" | "push", id: string, date?: string) {
  try { await invoke("reminder", { action, id, date: date ?? null }); } catch (err) { console.error(err); }
  await loadSnapshot();
}
export async function remAdd(text: string, date: string, project: string | null, repeat: string | null) {
  await invoke("reminder_add", { text, date, project, repeat });
  await loadSnapshot();
}
// a new conversation with the whole reminder in the composer, one Enter away from sending
export async function remChat(id: string) {
  const r = reminders().find(x => x.id === id); if (!r) return;
  await select(newChat(project(r.project) ? r.project : null));
  setTyped(t("rem.chatText", { date: r.date, text: r.text }));
}
