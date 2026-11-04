import { useState } from "react";
import type { Meeting } from "../../../domain/calendar/types";
import { savedSummary, acceptDraft, editSummary, generateDraft, type Wrap } from "../../../application/calendar/wrapup";
import { Markdown } from "../../components/Markdown";
import { useT } from "../../hooks/useT";
import { OUTLINE, SMALL_OUTLINE, SMALL_PRIMARY } from "./buttons";

/** The summary side of Wrap-up: the draft in its dashed card with Accept, Edit and Regenerate, a quiet line on what it is
 *  built from; while it is written, lines where the text will be; if it failed, why and Retry; once accepted, the summary
 *  as it is in the note. */
export function WrapDraft({ meeting, wrap, noteText }: { meeting: Meeting; wrap: Wrap | undefined; noteText: string }) {
  const { t } = useT();
  const [editing, setEditing] = useState<string | null>(null);
  const saved = !wrap || wrap.phase === "saved";
  const generating = wrap?.phase === "generating";
  const failed = wrap?.phase === "error";
  const shown = wrap && !saved ? wrap.summary : savedSummary(noteText) || wrap?.summary || "";
  return (
    <section
      aria-label={t("meet.wrap.summary")}
      className="min-w-0 min-h-0 overflow-y-auto px-8 pt-5 pb-8 select-text cursor-auto"
    >
      <div className="flex items-center gap-2.5">
        <h2 className="m-0 text-[15px] font-semibold">{t("meet.wrap.summary")}</h2>
        {saved ? (
          <span className="inline-flex items-center h-5 px-2 rounded-md bg-add-bg text-add-fg text-xs font-medium">
            {t("meet.wrap.saved")}
          </span>
        ) : failed ? null : (
          <span className="inline-flex items-center h-5 px-2 rounded-md border border-dashed border-soon text-soon text-[11px] font-semibold tracking-wider uppercase">
            {t("meet.wrap.draft")}
          </span>
        )}
        <span className="flex-1" />
        {saved || failed ? null : editing !== null ? (
          <>
            <button className={SMALL_OUTLINE} onClick={() => setEditing(null)}>
              {t("today.cancelEdit")}
            </button>
            <button
              className={SMALL_PRIMARY}
              onClick={() => {
                editSummary(meeting.id, editing);
                setEditing(null);
              }}
            >
              {t("today.saveBriefing")}
            </button>
          </>
        ) : (
          <>
            <button
              className={SMALL_PRIMARY}
              disabled={generating || wrap?.phase === "saving"}
              onClick={() => void acceptDraft(meeting)}
            >
              {t("meet.wrap.accept")}
            </button>
            <button className={SMALL_OUTLINE} disabled={generating} onClick={() => setEditing(wrap?.summary ?? "")}>
              {t("meet.wrap.edit")}
            </button>
            <button className={SMALL_OUTLINE} disabled={generating} onClick={() => void generateDraft(meeting)}>
              {t("meet.wrap.regenerate")}
            </button>
          </>
        )}
      </div>
      <div
        className={`mt-3 px-5 py-4.5 rounded-xl border ${saved ? "border-separator" : "border-dashed border-separator-strong bg-sidebar"}`}
      >
        {generating ? (
          <div role="status" aria-label={t("meet.wrap.writing")} className="flex flex-col gap-2.5 animate-skel">
            {[100, 92, 78, 0, 70, 88, 64, 80].map((w, i) =>
              w ? (
                <span key={i} className="h-3 rounded-sm bg-fill-2" style={{ width: `${w}%` }} />
              ) : (
                <span key={i} className="h-1.5" />
              ),
            )}
            <span className="mt-1 text-xs text-secondary">{t("meet.wrap.writing")}</span>
          </div>
        ) : failed ? (
          <div className="flex flex-col items-start gap-3">
            <span className="text-sm font-semibold">{t("meet.wrap.failed")}</span>
            <span className="text-[13px] text-secondary wrap-anywhere">{wrap.error}</span>
            <button className={OUTLINE} onClick={() => void generateDraft(meeting)}>
              {t("rec.retry")}
            </button>
          </div>
        ) : editing !== null ? (
          <textarea
            autoFocus
            value={editing}
            onChange={e => setEditing(e.target.value)}
            onKeyDown={e => e.key === "Escape" && setEditing(null)}
            rows={16}
            className="block w-full bg-transparent outline-0 resize-y text-sm leading-[1.55] font-mono select-text"
          />
        ) : (
          <Markdown text={shown} className="md-brief text-[14.5px] leading-[1.6] select-text" />
        )}
      </div>
      {wrap?.phase === "ready" || wrap?.phase === "saving" ? (
        <p className="m-0 mt-2.5 text-xs text-secondary">
          {wrap.error ? <span className="text-late">{wrap.error} </span> : null}
          {wrap.minutes
            ? t("meet.wrap.builtFrom", { lines: wrap.lines, minutes: wrap.minutes })
            : t("meet.wrap.builtFromNotes", { lines: wrap.lines })}
        </p>
      ) : null}
    </section>
  );
}
