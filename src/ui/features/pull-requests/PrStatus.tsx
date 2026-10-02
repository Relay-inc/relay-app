import type { ReactNode } from "react";
import type { Key } from "../../../shared/i18n";
import { useT } from "../../hooks/useT";
import { PrChip, type Tone } from "./PrChip";

const CI: Record<string, [Tone, Key]> = {
  SUCCESS: ["ok", "ci.ok"],
  FAILURE: ["bad", "ci.fail"],
  ERROR: ["bad", "ci.error"],
  PENDING: ["", "ci.pending"],
  EXPECTED: ["", "ci.expected"],
};
const REVIEW: Record<string, [Tone, Key]> = {
  APPROVED: ["ok", "rv.approved"],
  CHANGES_REQUESTED: ["bad", "rv.changes"],
};

/** The CI and review chips of a PR, then `children` (the detail adds conflicts and requested reviewers). `wrap`: the
 *  detail lets the chips wrap and puts them under the title. */
export function PrStatus({
  ci,
  review,
  wrap = false,
  children,
}: {
  ci: string | null;
  review: string | null;
  wrap?: boolean;
  children?: ReactNode;
}) {
  const { t } = useT();
  const chip = (labels: typeof CI, status: string | null) => {
    const label = status ? labels[status] : undefined;
    return label ? <PrChip tone={label[0]}>{t(label[1])}</PrChip> : null;
  };
  return (
    <div className={`flex gap-1.5 ${wrap ? "flex-wrap mt-2" : ""}`}>
      {chip(CI, ci)}
      {chip(REVIEW, review)}
      {children}
    </div>
  );
}
