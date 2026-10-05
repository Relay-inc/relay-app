import type { ReactNode } from "react";
import type { Kind, Status } from "../../../domain/today/plan";
import { Icon } from "../../components/Icon";
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
/** A context's dot (literal classes, so Tailwind finds them); grey for a project without a context. */
export const TINT_DOT: Record<string, string> = {
  "ctx-a": "bg-ctx-a",
  "ctx-m": "bg-ctx-m",
  "ctx-p": "bg-ctx-p",
  "": "bg-tertiary",
};

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

/** An item's status as a ring: empty to do, half in progress, ticked done. */
export function StatusDot({ status }: { status: Status }) {
  if (status === "done")
    return (
      <span className="grid place-items-center size-4 rounded-full bg-ok text-white">
        <Icon name="check" className="glyph size-2.5 stroke-[3]" />
      </span>
    );
  return (
    <span
      className={`block size-4 rounded-full border-[1.5px] ${status === "doing" ? "border-accent bg-[linear-gradient(90deg,var(--color-accent)_50%,transparent_50%)]" : "border-separator-strong"}`}
    />
  );
}
