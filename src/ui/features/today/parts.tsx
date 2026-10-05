import type { ReactNode } from "react";
import type { Kind } from "../../../domain/today/plan";
import type { Entry } from "../../../application/today/today";

/** The glyph of each kind of item. */
export const KIND_ICON: Record<Kind, string> = {
  ask: "agent",
  blocked: "term",
  prep: "cal",
  note: "cal",
  mail: "mail",
  reminder: "list",
  card: "board",
  review: "pr",
  fix: "pr",
  finished: "chat",
};
/** Why an item is here, as a colour: late red, soon orange, else grey. */
export const TONE_TEXT: Record<Entry["tone"], string> = { late: "text-late", soon: "text-soon", "": "text-secondary" };
export const TONE_BG: Record<Entry["tone"], string> = { late: "bg-late", soon: "bg-soon", "": "bg-separator-strong" };

/** A key's name next to a button. */
export function Kbd({ children, onAccent = false }: { children: ReactNode; onAccent?: boolean }) {
  return (
    <span
      className={`font-mono text-[11px] leading-none px-1.25 py-0.75 rounded-sm ${onAccent ? "opacity-75" : "text-tertiary border border-separator-strong"}`}
    >
      {children}
    </span>
  );
}
/** A small section label in capitals. */
export const Caps = ({ children }: { children: ReactNode }) => (
  <span className="text-[11px] font-semibold tracking-[0.06em] uppercase text-tertiary">{children}</span>
);
/** Minutes as "25 min" or "1.5 h". */
export const minutes = (n: number) => (n < 60 ? `${n} min` : `${Math.round((n / 60) * 10) / 10} h`);
