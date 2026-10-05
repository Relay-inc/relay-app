import type { ReactNode } from "react";
import { STATUS_TEXT } from "./blocks";

const STATUS_DOT = { ok: "bg-s-ok", warn: "bg-s-warn", off: "bg-s-muted/50" };

/** A status: a small dot and muted text. */
export function StatusLine({ level, children }: { level: keyof typeof STATUS_DOT; children: ReactNode }) {
  return (
    <span className={STATUS_TEXT}>
      <span className={`size-1.5 flex-none rounded-full ${STATUS_DOT[level]}`}></span>
      {children}
    </span>
  );
}
