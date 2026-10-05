import type { ReactNode } from "react";
import { POPOVER } from "./toolbar";

/** A popover under a toolbar button, right-aligned. The toolbar closes it (Escape, a click outside). */
export function BoardPopover({ width, children }: { width: string; children: ReactNode }) {
  return <div className={`absolute top-full right-0 mt-2 z-20 ${POPOVER} ${width}`}>{children}</div>;
}
