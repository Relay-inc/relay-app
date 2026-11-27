import type { ReactNode } from "react";
import { FOOTER, HINT } from "./blocks";
import { Info } from "./Info";

const CARD = "grid min-w-0 grid-cols-1 rounded-xl border border-s-border bg-raised [&>*]:min-w-0";

/** A section: a title and hint (`desc`) above a card, an action on the right of the title, a footer below.
 *  `list` packs the card for rows that bring their own padding, `rows` gives each child that padding and a hairline. Without a body there is no card. */
export function Section({
  title,
  desc,
  info,
  action,
  footer,
  list = false,
  rows = false,
  children,
}: {
  /** Without a title (and desc, action) there is no header: just the card */
  title?: ReactNode;
  desc?: ReactNode;
  /** the long explanation behind a small ⓘ next to the title, as plain text */
  info?: string;
  action?: ReactNode;
  footer?: ReactNode;
  list?: boolean;
  /** The card is a stack of rows (Fields), each with its own padding and a hairline above it */
  rows?: boolean;
  children?: ReactNode;
}) {
  const cardPadding = list
    ? "gap-0 py-0"
    : rows
      ? "gap-0 p-0 [&>*]:px-3.5 [&>*]:py-3 [&>*+*]:border-t [&>*+*]:border-s-border"
      : "gap-3.5 px-3.5 py-3";
  return (
    <section className="grid min-w-0 grid-cols-1 gap-2.5 [&>*]:min-w-0">
      {(title || desc || action) && (
        <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-48 flex-1 items-start gap-2.5">
            <div>
              <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-s-fg">
                {title}
                {info && <Info text={info} />}
              </h2>
              {desc && <p className={HINT}>{desc}</p>}
            </div>
          </div>
          {action && <div className="flex flex-none items-center gap-1.5 self-start">{action}</div>}
        </header>
      )}
      {children ? <div className={`${CARD} ${cardPadding}`}>{children}</div> : null}
      {footer ? <div className={FOOTER}>{footer}</div> : null}
    </section>
  );
}
