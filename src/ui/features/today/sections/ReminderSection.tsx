import { Markdown } from "../../../components/Markdown";
import type { SectionDef, SectionProps } from "./types";

/** A reminder's text, when it says more than its title. */
export function ReminderSection({ entry }: SectionProps<"reminder">) {
  const { reminder } = entry.subject;
  return reminder.text !== reminder.title ? (
    <Markdown text={reminder.text} className="text-sm leading-relaxed text-secondary max-w-170" />
  ) : null;
}
export const reminderFacts: SectionDef<"reminder">["facts"] = (entry, _day, t) => [
  [t("today.fact.repeat"), entry.subject.reminder.repeat ?? ""],
];
