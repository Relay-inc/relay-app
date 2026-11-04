import type { Glyph } from "../../../domain/today/day";
import { useT } from "../../hooks/useT";

/** A meeting's stage as the design draws it: ○ planned, ◐ briefed, ● live (red), ✓ wrapped, and ✉ besides when a
 *  follow-up was drafted. */
export function StageGlyph({
  glyph,
  className = "",
}: {
  glyph: Pick<Glyph, "stage" | "followed">;
  className?: string;
}) {
  const { t } = useT();
  const { stage, followed } = glyph;
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      {stage === "live" ? (
        <svg viewBox="0 0 12 12" className="size-2.75 flex-none" role="img" aria-label={t("meet.stageName.live")}>
          <circle cx="6" cy="6" r="4" className="fill-late" />
        </svg>
      ) : (
        <svg
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-2.75 flex-none"
          role="img"
          aria-label={t(`meet.stageName.${stage}`)}
        >
          <circle cx="6" cy="6" r="4.3" />
          {stage === "briefed" ? <path d="M6 1.7a4.3 4.3 0 0 1 0 8.6z" fill="currentColor" stroke="none" /> : null}
          {stage === "wrapped" ? <path d="M4 6.2 5.4 7.5 8 4.6" /> : null}
        </svg>
      )}
      {followed ? (
        <svg
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="round"
          className="size-2.75 flex-none"
          role="img"
          aria-label={t("meet.stageName.followed")}
        >
          <rect x="1.5" y="3" width="9" height="6.5" rx="1.2" />
          <path d="m2 3.6 4 3 4-3" />
        </svg>
      ) : null}
    </span>
  );
}
