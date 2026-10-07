import type { ReactNode } from "react";
import type { Status } from "../../../domain/today/plan";
import { Icon } from "../../components/Icon";

/** A square icon-only button. */
export const ICON_BUTTON =
  "grid place-items-center size-7.5 rounded-lg text-secondary cursor-pointer hover:bg-fill-2 hover:text-label";
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
