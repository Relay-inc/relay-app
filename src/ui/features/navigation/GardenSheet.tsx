import type { ReactNode } from "react";
import { useT } from "../../hooks/useT";
import { Html } from "../../components/Html";

const SAMPLE = 6;

/** A dry run over the Garden tab: what an action would do (one summary line, a sample of the notes or files), and
 *  Cancel / Apply. Nothing is written until Apply; it is the one filled button while it is open. */
export function GardenSheet({
  title,
  summary,
  rows,
  extra,
  note,
  apply,
  busy,
  onCancel,
  onApply,
}: {
  title: string;
  summary: string;
  rows: string[];
  extra?: ReactNode;
  note: string;
  apply: string;
  busy: boolean;
  onCancel: () => void;
  onApply: () => void;
}) {
  const { t } = useT();
  return (
    <div
      role="dialog"
      aria-label={title}
      onKeyDown={e => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        onCancel();
      }}
      className="absolute top-13 inset-x-5 grid gap-3 px-5 py-4 bg-bg rounded-b-xl shadow-lg border border-separator text-sm text-label"
    >
      <div className="flex items-center gap-2">
        <h3 className="text-base font-semibold">{title}</h3>
        <span className="h-5 inline-flex items-center px-2 rounded-md border border-dashed border-soon text-soon text-xs font-semibold uppercase tracking-wider">
          {t("tidy.dryRun")}
        </span>
      </div>
      <Html as="p" html={summary} />
      <div className="border border-separator rounded-lg overflow-hidden font-mono text-xs">
        {rows.slice(0, SAMPLE).map(row => (
          <div key={row} className="flex items-center h-7.5 px-3 border-t border-separator first:border-t-0">
            <span className="min-w-0 truncate">{row}</span>
          </div>
        ))}
        {rows.length > SAMPLE ? (
          <div className="px-3 py-1.5 border-t border-separator font-sans text-secondary">
            {t("tidy.more", { n: rows.length - SAMPLE })}
          </div>
        ) : null}
      </div>
      {extra}
      <div className="flex items-center gap-2">
        <p className="flex-1 text-xs text-secondary">{note}</p>
        <button type="button" className="btn cursor-pointer" onClick={onCancel} autoFocus>
          {t("pages.cancel")}
        </button>
        <button
          type="button"
          className="btn btn-primary cursor-pointer disabled:opacity-50"
          disabled={busy || !rows.length}
          onClick={onApply}
        >
          {apply}
        </button>
      </div>
    </div>
  );
}
