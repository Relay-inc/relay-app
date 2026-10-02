import { useEffect, useRef, type KeyboardEvent } from "react";
import type { ReminderDraft } from "../../../domain/reminders/types";
import { todayIso } from "../../../domain/reminders/rules";
import { addDraft, closeDraft, openDraft, patchDraft } from "../../../application/reminders/draft";
import { useT } from "../../hooks/useT";

const REPEATS = ["", "1w", "14d", "1m", "3m"];
const FIELD =
  "border border-separator rounded-lg bg-bg text-label px-2 min-w-0 focus-visible:outline-2 focus-visible:outline-accent/45";

/** The new-reminder form. The draft lives in the reminders store (it survives switching views), every change and the
 *  add go through its use cases. */
export function ReminderForm({
  draft,
  projects,
}: {
  draft: ReminderDraft;
  projects: { name: string; label: string }[];
}) {
  const { t } = useT();
  const textField = useRef<HTMLInputElement>(null);
  const focusText = useRef(false); // opening the form: focus the text field once it is drawn
  useEffect(() => {
    if (!focusText.current) return;
    focusText.current = false;
    textField.current?.focus();
  });

  const open = () => {
    focusText.current = true;
    openDraft();
  };
  const submit = () => {
    if (!draft.text.trim()) {
      textField.current?.focus();
      return;
    }
    addDraft();
  };
  // Enter in the text field adds, Escape anywhere in the form closes it
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" && e.target === textField.current) {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      closeDraft();
    }
  };

  if (!draft.open)
    return (
      <div className="mb-4">
        <button className="btn" onClick={open}>
          {t("rem.new")}
        </button>
      </div>
    );
  return (
    <div className="mb-4 flex flex-col gap-2 p-3 border border-separator rounded-xl bg-fill" onKeyDown={onKey}>
      <input
        ref={textField}
        className={`${FIELD} h-8 text-base`}
        value={draft.text}
        onChange={e => patchDraft({ text: e.target.value })}
        placeholder={t("rem.newText")}
        aria-label={t("rem.newText")}
        spellCheck={false}
      />
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="date"
          className={`${FIELD} h-7 text-sm`}
          value={draft.date}
          onChange={e => patchDraft({ date: e.target.value })}
          min={todayIso()}
          aria-label={t("rem.newDate")}
        />
        <select
          className={`${FIELD} h-7 text-sm`}
          value={draft.project}
          onChange={e => patchDraft({ project: e.target.value })}
          aria-label={t("rem.newProject")}
        >
          <option value="">{t("rem.noProject")}</option>
          {projects.map(project => (
            <option key={project.name} value={project.name}>
              {project.label}
            </option>
          ))}
        </select>
        <select
          className={`${FIELD} h-7 text-sm`}
          value={draft.repeat}
          onChange={e => patchDraft({ repeat: e.target.value })}
          aria-label={t("rem.newRepeat")}
        >
          {REPEATS.map(repeat => (
            <option key={repeat} value={repeat}>
              {repeat ? t("rem.every", { n: repeat }) : t("rem.noRepeat")}
            </option>
          ))}
        </select>
        <span className="ml-auto flex gap-1.5">
          <button className="btn" onClick={closeDraft}>
            {t("rem.cancel")}
          </button>
          <button className="btn btn-primary disabled:opacity-50" disabled={draft.busy} onClick={submit}>
            {t("rem.add")}
          </button>
        </span>
      </div>
      {draft.err && (
        <div className="text-sm text-late" role="alert">
          {draft.err}
        </div>
      )}
    </div>
  );
}
