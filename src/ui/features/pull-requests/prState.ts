import type { Key } from "../../../shared/i18n";
import type { Translate } from "../../../domain/conversations/state";
import type { PR } from "../../../domain/pull-requests/types";

/** A PR's CI result as a tone (ok, bad, run) with its label; the colour classes are the caller's. */
export const CI: Record<string, ["ok" | "bad" | "run", Key]> = {
  SUCCESS: ["ok", "ci.ok"],
  FAILURE: ["bad", "ci.fail"],
  ERROR: ["bad", "ci.error"],
  PENDING: ["run", "ci.pending"],
  EXPECTED: ["run", "ci.expected"],
};
export const CI_TEXT = { ok: "text-ok", bad: "text-late", run: "text-soon" };

/** The colour of a PR's glyph: draft grey, changes requested red, approved green, else the accent (no decision yet,
 *  decided to stay accent against the design's green). */
export const prColor = (pr: Pick<PR, "draft" | "review">) =>
  pr.draft
    ? "text-tertiary"
    : pr.review === "CHANGES_REQUESTED"
      ? "text-bad"
      : pr.review === "APPROVED"
        ? "text-ok"
        : "text-accent";

const MS_PER_DAY = 864e5;
/** How long ago a PR was opened: "today" or "N d". */
export const age = (iso: string, t: Translate) => {
  const days = Math.floor((Date.now() - Date.parse(iso)) / MS_PER_DAY);
  return days < 1 ? t("due.today") : t("pr.days", { n: days });
};
