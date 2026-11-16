import { useTodayStore } from "../../../../application/today/store";
import { useT } from "../../../hooks/useT";
import type { SectionProps } from "./types";

/** The day's time to book. */
export function TimeSection({ entry }: SectionProps<"time">) {
  const { t, tn } = useT();
  const services = useTodayStore(s => s.timesheetServices);
  return (
    <>
      <p className="m-0 text-sm text-secondary">{t("today.timeBody", { n: entry.subject.minutes })}</p>
      {services > 0 && <p className="m-0 mt-2 text-sm text-secondary">{tn("time.timesheet", services)}</p>}
    </>
  );
}
