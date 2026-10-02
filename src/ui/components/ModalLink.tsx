import type { ReactNode } from "react";
import { Icon } from "./Icon";

/** A link in a window's or detail's header; the app opens it in the browser. */
export function ModalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      className="inline-flex items-center gap-1 h-7 px-2.5 rounded-[7px] text-xs text-secondary no-underline hover:bg-fill-2 hover:text-label"
      href={href}
    >
      {children}
      <Icon name="out" className="glyph size-3" />
    </a>
  );
}
