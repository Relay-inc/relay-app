import { useState } from "react";
import type { Key } from "../../../shared/i18n";
import { esc } from "../../../shared/html";
import { raw } from "../../../shared/i18n";
import type { Reminder } from "../../../domain/reminders/types";
import { urgency } from "../../../domain/reminders/rules";
import { reminderAction, chatAboutReminder, projectTint } from "../../../application/reminders/reminders";
import { useRemindersStore } from "../../../application/reminders/store";
import { useWorkspaceStore } from "../../../application/workspace/store";
import { projectLabel, projectsByLabel } from "../../../application/workspace/vault";
import { Html } from "../../components/Html";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { ReminderForm } from "./ReminderForm";
import { ReminderRow } from "./ReminderRow";

const GROUPS: [Key, (days: number) => boolean, string][] = [
  ["rem.late", days => days < 0, "text-late"],
  ["rem.today", days => days === 0, "text-soon"],
  ["rem.tomorrow", days => days === 1, "text-tertiary"],
  ["rem.week", days => days >= 2 && days <= 7, "text-tertiary"],
  ["rem.later", days => days > 7, "text-tertiary"],
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
  const tints = useDerived(() =>
    Object.fromEntries(all.map(reminder => [reminder.id, projectTint(reminder.project)] as const)),
  );
  const draftTint = useDerived(() => projectTint(draft.project || null));
  const [calendarRow, setCalendarRow] = useState<string | null>(null); // the row whose date picker is open
  const [busyRow, setBusyRow] = useState<string | null>(null); // the row whose action is running

  const runAction = async (reminder: Reminder, action: "done" | "push", date?: string) => {
    setBusyRow(reminder.id);
    setCalendarRow(null);
    await reminderAction(reminder, action, date); // never throws: a failure is logged and the vault read again
    setBusyRow(null);
  };

  const groups = () => {
    if (!all.length) return <div className="text-secondary text-center py-6">{t("rem.none")}</div>;
    return GROUPS.map(([name, inGroup, tint]) => {
      const due = all.filter(reminder => inGroup(reminder.days)).sort((a, b) => a.days - b.days);
      if (!due.length) return null;
      return (
        <section key={name}>
          <h2
            className={`flex items-baseline gap-1.5 pb-2 border-b border-separator text-[11px] font-semibold uppercase tracking-[0.06em] ${tint}`}
          >
            {t(name)} <span className="text-tertiary tabular-nums">{due.length}</span>
          </h2>
          {due.map(reminder => (
            <ReminderRow
              key={reminder.id}
              reminder={reminder}
              label={labels[reminder.id] ?? ""}
              tint={tints[reminder.id] ?? ""}
              urgency={urgency(reminder.days)}
              busy={busyRow === reminder.id}
              cal={calendarRow === reminder.id}
              onChat={() => chatAboutReminder(reminder.id)}
              onDone={() => runAction(reminder, "done")}
              onPush={date => runAction(reminder, "push", date)}
              onCalendar={() => setCalendarRow(calendarRow === reminder.id ? null : reminder.id)}
              onCloseCalendar={() => setCalendarRow(null)}
            />
          ))}
        </section>
      );
    });
  };

  return (
    <div className="flex flex-col gap-[24px]">
      {/* the form's slot stays in the flex column while it is closed, as the Lit host did (the gap above the groups) */}
      <div>
        <ReminderForm draft={draft} projects={projects} tint={draftTint} />
      </div>
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
