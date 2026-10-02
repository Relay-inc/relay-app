import type { ReminderDraft } from "../../domain/reminders/types";
import { makeStore } from "../make-store";

// The reminders themselves are part of the vault snapshot (useWorkspaceStore). This store only keeps the
// new-reminder form, so a half-typed reminder survives switching views and an add that resolves while the view is
// gone still closes the form the view shows when it comes back.
const EMPTY_DRAFT: ReminderDraft = {
  open: false,
  text: "",
  date: "",
  project: "",
  repeat: "",
  err: "",
  busy: false,
};

type RemindersState = { draft: ReminderDraft };

export const useRemindersStore = makeStore<RemindersState>(() => ({ draft: EMPTY_DRAFT }));
