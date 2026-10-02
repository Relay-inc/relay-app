import type { ReactNode } from "react";

/** A popover under a toolbar button, right-aligned. The toolbar closes it (Escape, a click outside). */
export function BoardPopover({ width, children }: { width: string; children: ReactNode }) {
  return (
    <div
      className={`absolute top-full right-0 mt-1.5 z-20 ${width} rounded-xl bg-raised shadow-md ring-1 ring-separator-strong`}
    >
      {children}
    </div>
  );
}
