import type { ReactNode } from "react";
import { useT } from "../../hooks/useT";
import { Html } from "../../components/Html";

const SAMPLE = 6;

/** A dry run over the vault check (Tidy structure, Ask Claude, Move to trash): what an action would do, one summary
 *  line (markup; null while it is read) and a sample of its rows with "+ n more" and any `foot` lines, then Cancel /
 *  Apply. Nothing is written until Apply; it is the one filled button while it is open. Escape is the dialog's. */
export function DryRunSheet({
  title,
  summary,
  rows,
  foot = [],
  extra,
  note,
  apply,
  busy,
  onCancel,
  onApply,
}: {
  title: string;
  summary: string | null;
  rows: ReactNode[];
  foot?: string[];
  extra?: ReactNode;
  note: string;
  apply: string;
  busy: boolean;
  onCancel: () => void;
  onApply: () => void;
}) {
  const { t } = useT();
  const below = [rows.length > SAMPLE ? t("tidy.more", { n: rows.length - SAMPLE }) : "", ...foot].filter(Boolean);
  return (
    <div
      role="dialog"
      aria-label={title}
      className="absolute top-13 inset-x-5 grid gap-3 px-5 py-4 bg-bg rounded-b-xl shadow-lg border border-separator text-sm text-label"
    >
      <div className="flex items-center gap-2">
        <h3 className="text-base font-semibold">{title}</h3>
        <span className="h-5 inline-flex items-center px-2 rounded-md border border-dashed border-soon text-soon text-xs font-semibold uppercase tracking-wider">
          {t("tidy.dryRun")}
        </span>
      </div>
      {summary === null ? (
        <p className="text-secondary">{t("tidy.reading")}</p>
      ) : (
        <>
          <Html as="p" html={summary} />
          <div className="border border-separator rounded-lg overflow-hidden font-mono text-xs">
            {rows.slice(0, SAMPLE).map((row, i) => (
              <div key={i} className="flex items-center gap-2 h-7.5 px-3 border-t border-separator first:border-t-0">
                {row}
              </div>
            ))}
            {below.length ? (
              <div className="grid gap-0.5 px-3 py-1.5 border-t border-separator font-sans text-secondary">
                {below.map(line => (
                  <span key={line}>{line}</span>
                ))}
              </div>
            ) : null}
          </div>
        </>
      )}
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
