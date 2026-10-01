import type { Key } from "../../core/locales/en";
import type { PR } from "../../domain/prs";

/** A PR's CI result as a tone (ok, bad, run) with its label; the colour classes are the caller's. */
export const CI: Record<string, ["ok" | "bad" | "run", Key]> = {
  SUCCESS: ["ok", "ci.ok"],
  FAILURE: ["bad", "ci.fail"],
  ERROR: ["bad", "ci.error"],
  PENDING: ["run", "ci.pending"],
  EXPECTED: ["run", "ci.expected"],
};
export const CI_TEXT = { ok: "text-ok", bad: "text-late", run: "text-soon" };

/** The colour of a PR's glyph: draft grey, changes requested red, approved green, else the accent. */
export const prColor = (pr: Pick<PR, "draft" | "review">) =>
  pr.draft
    ? "text-secondary"
    : pr.review === "CHANGES_REQUESTED"
      ? "text-bad"
      : pr.review === "APPROVED"
        ? "text-ok"
        : "text-accent";
