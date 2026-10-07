import type { ActionSet, ActionSpec, Words } from "./types.ts";

export const MIN = 60_000;
export const DAY = 86_400_000;
export const startOfDay = (now: number) => new Date(now).setHours(0, 0, 0, 0);
/** "5 min ago" / "2 h ago". */
export const ago = (since: number, now: number, w: Words) => {
  const minutes = Math.max(0, Math.floor((now - since) / MIN));
  return minutes < 60 ? w.t("wait.agoMin", { n: minutes }) : w.t("wait.agoHour", { n: Math.floor(minutes / 60) });
};
/** A ticket number as it is written: "#212 " for digits, "ENG-12 " as it is, nothing without one. */
export const numbered = (number: string | undefined) => (number ? `${/^\d+$/.test(number) ? "#" : ""}${number} ` : "");

/** An action set: the actions, which of them Enter and Backspace run (an index, or null for none) and Done. */
export const actionSet = <A extends string>(
  acts: ActionSpec<A>[],
  primary: number | null,
  secondary: number | null,
  done?: ActionSpec<A>,
): ActionSet<A> => ({
  acts,
  primary: primary === null ? undefined : primary,
  secondary: secondary === null ? undefined : secondary,
  done,
});
/** E: done where the item lives, or dismissed from Today when it lives nowhere else (application/today/actions). */
export const doneAction = (w: Words, label = w.t("today.status.done"), icon = "check"): ActionSpec<never> => ({
  id: "done",
  label,
  icon,
  key: "E",
});
