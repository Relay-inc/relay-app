import type { ReactNode } from "react";
import { Note } from "./Note";

/** A detail in the right panel (a PR, mail, note or card): the bar with the close button and what follows it in
 *  `bar`, then the error, the loading line, or the detail itself. `before` goes above the bar (an action's error). */
export function DetailFrame({
  closeLabel,
  onClose,
  bar,
  before,
  err,
  loading,
  children,
}: {
  closeLabel: string;
  onClose: () => void;
  bar?: ReactNode;
  before?: ReactNode;
  err?: string;
  /** the loading line while the detail is not known yet; leave it out once it is */
  loading?: string;
  children?: ReactNode;
}) {
  let content = children;
  if (err) content = <div className="err-box">{err}</div>;
  else if (loading !== undefined) content = <Note>{loading}</Note>;
  return (
    <div>
      {before}
      <div className="flex items-center flex-wrap gap-2 mb-3">
        <button
          className="btn whitespace-nowrap flex-none"
          title={closeLabel}
          aria-label={closeLabel}
          onClick={onClose}
        >
          ×
        </button>
        {bar}
      </div>
      {content}
    </div>
  );
}
