import type { LimitWindow } from "../agents/types";
import type { ProvLimits } from "./types";

const DAY = 86400000;
/** The start of today and of this week, which starts on Monday. */
export function periodStarts(now: Date) {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const today = midnight.getTime();
  return { today, week: today - ((midnight.getDay() + 6) % 7) * DAY };
}
export const level = (pct: number): "" | "soon" | "late" => {
  if (pct >= 95) return "late";
  return pct >= 80 ? "soon" : "";
};
/** The limit window closest to its limit, over every provider that answered. */
export function mostConstrained(limits: ProvLimits[] | null): { limitWindow: LimitWindow; id: string } | null {
  let top: { limitWindow: LimitWindow; id: string } | null = null;
  for (const entry of limits || [])
    if (entry.limits.ok)
      for (const limitWindow of entry.limits.windows)
        if (!top || limitWindow.pct > top.limitWindow.pct) top = { limitWindow, id: entry.provider };
  return top;
}
