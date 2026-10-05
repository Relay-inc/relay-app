import { WAIT } from "../../domain/navigation/views";
import { opened, mailKey } from "../../domain/navigation/keys";
import { workItems, type Work } from "../../domain/today/work";
import { useNavigationStore } from "../navigation/store";
import { select, toast } from "../navigation/navigation";
import { t } from "../../shared/i18n";
import { useCalendarStore } from "../calendar/store";
import { meetingProjectOf } from "../calendar/calendar";
import { useRecordingStore } from "../calendar/recording";
import { useMailStore } from "../mail/store";
import { mailProject } from "../mail/mail";
import { useDetailsStore } from "./details";
import { closeCompose } from "./mail";
import { discardReview, useReviewStore } from "./review";
import { entries, focusEntry, openMeeting } from "./today";
import { useTodayStore } from "./store";

// Today's work in progress (domain/today/work.ts) from the state that holds it, for the sidebar: a row per item under
// its project, which opens Today on it, and closing one discards it.

/** The work in progress now. */
export function currentWork(now = Date.now()): Work[] {
  const day = new Date(now).setHours(0, 0, 0, 0);
  const compose = useDetailsStore.getState().compose;
  const mail = compose ? useMailStore.getState().list?.find(m => mailKey(m) === compose.key) : undefined;
  const recorder = useRecordingStore.getState();
  return workItems({
    reviews: Object.entries(useReviewStore.getState().reviews)
      .filter(([, r]) => r.title)
      .map(([item, r]) => ({ item, title: r.title, project: r.project })),
    compose: compose
      ? { mail: compose.key, title: mail?.subject ?? compose.key, project: mail ? mailProject(mail) : null }
      : null,
    meetings: useCalendarStore
      .getState()
      .list.filter(m => Date.parse(m.start) >= day && Date.parse(m.start) < day + 86_400_000)
      .map(m => ({
        id: m.id,
        title: m.title,
        start: Date.parse(m.start),
        end: Date.parse(m.end),
        project: meetingProjectOf(m),
        item: null,
      })),
    recording: recorder.phase !== "idle" ? (recorder.meeting?.id ?? null) : null,
    now,
  });
}

/** The work rows of one sidebar section: a project's, or General's (null). */
export const workOf = (project: string | null, now = Date.now()) => currentWork(now).filter(w => w.project === project);

/** Whether the row is what Today shows now. */
export function isOpenWork(work: Work) {
  if (useNavigationStore.getState().selected !== WAIT) return false;
  if (work.kind === "review") return useNavigationStore.getState().selected === work.key;
  return useTodayStore.getState().selected === work.item;
}

/** A work row clicked: Today, on that item (a review's screen, the mail with its draft, the meeting's prep or note).
 *  When its item left Today (the PR was merged, the mail archived elsewhere) it says so and offers to discard it. */
export async function openWork(key: string) {
  const target = opened(key);
  if (target.kind !== "work") return;
  // a review is a view of its own: its screen loads itself, and says so when the PR left Today
  if (target.work === "review") return void (await select(key));
  await select(WAIT);
  if (target.work === "meeting") {
    openMeeting(target.id);
    return;
  }
  const id = target.work === "mail" ? `mail:${target.id}` : target.id;
  const item = entries().find(entry => entry.id === id);
  if (!item) return toast(t(`today.work.gone.${target.work}`), () => closeWork(key), t("today.work.discard"));
  focusEntry(item.id);
}

/** A work row closed: the review or the draft is discarded (a meeting cannot be closed). */
export function closeWork(key: string) {
  const target = opened(key);
  if (target.kind !== "work") return;
  if (target.work === "review") discardReview(target.id);
  if (target.work === "mail") closeCompose();
}
