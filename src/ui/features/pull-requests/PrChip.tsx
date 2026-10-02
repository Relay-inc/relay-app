import type { ReactNode } from "react";

export type Tone = "ok" | "bad" | "";
const TONE: Record<Tone, string> = { ok: "text-ok bg-ok/10", bad: "text-bad bg-bad/10", "": "text-secondary bg-fill" };

/** A small status pill: grey, pale green or pale red. */
export function PrChip({ tone = "", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-full whitespace-nowrap block ${TONE[tone]}`}
    >
      {children}
    </span>
  );
}
