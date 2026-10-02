/** red when overdue, orange today and in the next 2 days, grey after that (decided 29/9) */
export const urgency = (days: number): "late" | "soon" | "" => (days < 0 ? "late" : days <= 2 ? "soon" : "");
/** A local date as yyyy-mm-dd; `month` counts from 0 as in Date. */
export const isoDate = (year: number, month: number, day: number) =>
  `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
/** Today, or `daysAhead` days from now, as yyyy-mm-dd. */
export const todayIso = (daysAhead = 0) => {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  return isoDate(date.getFullYear(), date.getMonth(), date.getDate());
};
