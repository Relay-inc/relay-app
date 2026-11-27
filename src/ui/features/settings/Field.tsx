import type { ReactNode } from "react";
import { CODE } from "./blocks";
import { Info } from "./Info";

const LABEL = "block text-[13px] leading-snug text-s-fg";
const FIELD_HINT = `mt-px text-xs leading-[1.45] text-s-muted ${CODE}`;

/** A field: its label and hint on the left, the control on the right. With `id` the label points at the control. */
export function Field({
  label,
  hint,
  info,
  id,
  className = "",
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  /** the long explanation behind a small ⓘ, as plain text in its tooltip */
  info?: string;
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`flex items-center justify-between gap-4 ${className}`} data-search-row>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {id ? (
            <label htmlFor={id} className={LABEL} data-search-label>
              {label}
            </label>
          ) : (
            <span className={LABEL} data-search-label>
              {label}
            </span>
          )}
          {info && <Info text={info} />}
        </div>
        {hint && (
          <p className={FIELD_HINT} data-search-hint>
            {hint}
          </p>
        )}
      </div>
      <div className="flex min-h-7 min-w-0 flex-initial items-center justify-end gap-2">{children}</div>
    </div>
  );
}
