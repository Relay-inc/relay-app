import { useState } from "react";
import type { Key } from "../../../shared/i18n";
import { esc } from "../../../shared/html";
import { raw } from "../../../shared/i18n";
import type { Reminder } from "../../../domain/reminders/types";
import { urgency } from "../../../domain/reminders/rules";
import { reminderAction, chatAboutReminder } from "../../../application/reminders/reminders";
import { useRemindersStore } from "../../../application/reminders/store";
import { useWorkspaceStore } from "../../../application/workspace/store";
import { projectLabel, projectsByLabel } from "../../../application/workspace/vault";
import { Html } from "../../components/Html";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { ReminderForm } from "./ReminderForm";
import { ReminderRow } from "./ReminderRow";

const GROUPS: [Key, (days: number) => boolean][] = [
  ["rem.late", days => days < 0],
  ["rem.today", days => days === 0],
  ["rem.tomorrow", days => days === 1],
  ["rem.week", days => days >= 2 && days <= 7],
  ["rem.later", days => days > 7],
];

/** The reminders view: the new-reminder form, then the reminders grouped by when they are due. */
export function RemindersView() {
  const { t, th, locale } = useT();
  const all = useWorkspaceStore(s => s.snap.reminders) as Reminder[];
  const vault = useWorkspaceStore(s => s.snap.vault);
  const draft = useRemindersStore(s => s.draft);
  const projects = useDerived(() => projectsByLabel(locale));
  const labels = useDerived(() =>
    Object.fromEntries(all.map(reminder => [reminder.id, reminder.project ? projectLabel(reminder.project) : ""])),
  );
  const [calendarRow, setCalendarRow] = useState<string | null>(null); // the row whose date picker is open
  const [busyRow, setBusyRow] = useState<string | null>(null); // the row whose action is running

  const runAction = async (id: string, action: "done" | "push", date?: string) => {
    setBusyRow(id);
    setCalendarRow(null);
    await reminderAction(action, id, date); // never throws: a failure is logged and the vault read again
    setBusyRow(null);
  };

  const groups = () => {
    if (!all.length) return <div className="text-secondary text-center py-6">{t("rem.none")}</div>;
    return GROUPS.map(([name, inGroup]) => {
      const due = all.filter(reminder => inGroup(reminder.days)).sort((a, b) => a.days - b.days);
      if (!due.length) return null;
      return (
        <section key={name} className="mb-6">
          <h2 className="list-head">
            {t(name)} <span className="font-mono tabular-nums">{due.length}</span>
          </h2>
          {due.map(reminder => (
            <ReminderRow
              key={reminder.id}
              reminder={reminder}
              label={labels[reminder.id] ?? ""}
              urgency={urgency(reminder.days)}
              busy={busyRow === reminder.id}
              cal={calendarRow === reminder.id}
              onChat={() => chatAboutReminder(reminder.id)}
              onDone={() => runAction(reminder.id, "done")}
              onPush={date => runAction(reminder.id, "push", date)}
              onCalendar={() => setCalendarRow(calendarRow === reminder.id ? null : reminder.id)}
              onCloseCalendar={() => setCalendarRow(null)}
            />
          ))}
        </section>
      );
    });
  };

  return (
    <div className="flex flex-col gap-[18px]">
      <ReminderForm draft={draft} projects={projects} />
      {/* shown when the vault has no reminders file yet */}
      {vault?.found?.reminders === false && (
        <Html
          as="div"
          className="text-secondary mb-2.5"
          html={th("rem.noFile", {
            path: raw(`<code class="font-mono">${esc(vault.map?.reminders ?? "")}</code>`),
          })}
        />
      )}
      {groups()}
    </div>
  );
}
