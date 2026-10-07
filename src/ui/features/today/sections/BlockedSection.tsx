import { useT } from "../../../hooks/useT";
import type { SectionProps } from "./types";

/** A background session in the terminal that waits. */
export function BlockedSection({ entry }: SectionProps<"blocked">) {
  const { t } = useT();
  const { session } = entry.subject;
  return (
    <p className="m-0 text-sm text-secondary">
      {t("wait.bg", { date: session.startedAt ? new Date(session.startedAt).toLocaleDateString() : "" })}
    </p>
  );
}
