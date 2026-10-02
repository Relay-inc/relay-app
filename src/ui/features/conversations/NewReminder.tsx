import { openReminderForm } from "../../../application/reminders/draft";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";

/** The reminders view's title bar button: it opens the new-reminder form. */
export function NewReminder() {
  const { t } = useT();
  return (
    <button
      className="btn h-7 px-2.5 rounded-[7px] text-xs inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
      onClick={openReminderForm}
    >
      <Icon name="add" className="glyph size-3.5" />
      {t("rem.new")}
    </button>
  );
}
