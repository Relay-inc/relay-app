import { useEffect, useRef, type KeyboardEvent } from "react";
import type { ReminderDraft } from "../../../domain/reminders/types";
import { todayIso } from "../../../domain/reminders/rules";
import type { Section } from "../../../domain/navigation/sidebar";
import { addDraft, closeDraft, patchDraft } from "../../../application/reminders/draft";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";
import { TINT_TEXT } from "./tints";

const REPEATS = ["", "1w", "14d", "1m", "3m"];
// a pill: the control inside is bare, the icons sit on top of it
const PILL =
  "relative inline-flex items-center h-7 rounded-[7px] bg-fill-2 text-xs focus-within:outline-2 focus-within:outline-accent/45";
const BARE = "h-7 bg-transparent border-0 outline-0 text-xs cursor-pointer min-w-0";
const SELECT = `${BARE} appearance-none pl-7 pr-6`;
const PILL_ICON = "glyph absolute left-2.5 size-3.25 pointer-events-none";
const CHEVRON = "glyph absolute right-2 size-2.75 text-tertiary pointer-events-none [stroke-width:2]";

/** The new-reminder form, shown once the title bar's button opened it. The draft lives in the reminders store (it
 *  survives switching views), every change and the add go through its use cases. `tint` is the picked project's colour. */
export function ReminderForm({
  draft,
  projects,
  tint,
}: {
  draft: ReminderDraft;
  projects: { name: string; label: string }[];
  tint: Section["tint"];
}) {
  const { t } = useT();
  const textField = useRef<HTMLInputElement>(null);
  // the form was opened (from the title bar's button): focus the text field once it is drawn
  useEffect(() => {
    if (draft.open) textField.current?.focus();
  }, [draft.open]);

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

  if (!draft.open) return null;
  return (
    <div
      className="flex flex-col gap-2.5 p-3.5 border border-separator-strong rounded-xl bg-raised shadow-md"
      onKeyDown={onKey}
    >
      <input
        ref={textField}
        className="h-8.5 px-0.5 border-0 outline-0 bg-transparent text-[15px] text-label placeholder:text-tertiary"
        value={draft.text}
        onChange={e => patchDraft({ text: e.target.value })}
        placeholder={t("rem.newText")}
        aria-label={t("rem.newText")}
        spellCheck={false}
      />
      <div className="flex flex-wrap items-center gap-2">
        <label className={PILL}>
          <Icon name="cal" className={`${PILL_ICON} text-secondary`} />
          <input
            type="date"
            className={`${BARE} pl-7 pr-2.5`}
            value={draft.date}
            onChange={e => patchDraft({ date: e.target.value })}
            min={todayIso()}
            aria-label={t("rem.newDate")}
          />
        </label>
        <label className={PILL}>
          <Icon name="folder" className={`${PILL_ICON} ${TINT_TEXT[tint]}`} />
          <select
            className={SELECT}
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
          <Icon name="chevron" className={CHEVRON} />
        </label>
        <label className={`${PILL} ${draft.repeat ? "" : "text-secondary"}`}>
          <Icon name="refresh" className={`${PILL_ICON} text-secondary`} />
          <select
            className={SELECT}
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
          <Icon name="chevron" className={CHEVRON} />
        </label>
        <span className="ml-auto flex gap-2">
          <button className="btn h-7.5 px-3 rounded-lg text-[13px] cursor-pointer" onClick={closeDraft}>
            {t("rem.cancel")}
          </button>
          <button
            className="btn btn-primary h-7.5 px-3 rounded-lg text-[13px] cursor-pointer disabled:opacity-50"
            disabled={draft.busy}
            onClick={submit}
          >
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
