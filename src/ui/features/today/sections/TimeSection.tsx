import { useT } from "../../../hooks/useT";
import type { SectionProps } from "./types";

/** The day's time to book. */
export function TimeSection({ entry }: SectionProps<"time">) {
  const { t } = useT();
  return <p className="m-0 text-sm text-secondary">{t("today.timeBody", { n: entry.subject.minutes })}</p>;
}
