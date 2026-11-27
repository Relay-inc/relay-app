import type { ReactNode } from "react";
import { STATUS_TEXT } from "./blocks";

const STATUS_DOT = { ok: "bg-s-ok", warn: "bg-s-warn", off: "bg-s-muted/50", bad: "bg-s-err" };

/** A status: a small dot and muted text; `bad` (failed) in the error colour. */
export function StatusLine({ level, children }: { level: keyof typeof STATUS_DOT; children: ReactNode }) {
  return (
    <span className={`${STATUS_TEXT} ${level === "bad" ? "text-s-err!" : ""}`}>
      <span className={`size-1.5 flex-none rounded-full ${STATUS_DOT[level]}`}></span>
      {children}
    </span>
  );
}
