// Reminders from the vault (the reminders file in the snapshot). Done, tomorrow, +1 week and a date go through the
// vault's reminder script in the backend; a reminder can also start a conversation.
export type Reminder = {
  id: string;
  date: string;
  days: number;
  project: string | null;
  title: string;
  text: string;
  repeat: string | null;
};
/** The new-reminder form while it is being filled in; kept in the store so it survives switching views. */
export type ReminderDraft = {
  open: boolean;
  text: string;
  date: string;
  project: string;
  repeat: string;
  err: string;
  busy: boolean;
};
