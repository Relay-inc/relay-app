import type { ReactNode } from "react";
import { FOOTER, HINT } from "./blocks";

const CARD = "grid min-w-0 grid-cols-1 rounded-xl border border-s-border bg-raised [&>*]:min-w-0";

/** A section: a title and hint (`desc`) above a card, an action on the right of the title, a footer below.
 *  `list` packs the card for rows that bring their own padding. Without a body there is no card. */
export function Section({
  title,
  desc,
  action,
  footer,
  list = false,
  children,
}: {
  title: ReactNode;
  desc?: ReactNode;
  action?: ReactNode;
  footer?: ReactNode;
  list?: boolean;
  children?: ReactNode;
}) {
  const cardPadding = list ? "gap-0 py-0" : "gap-3.5 px-3.5 py-3";
  return (
    <section className="grid min-w-0 grid-cols-1 gap-2.5 [&>*]:min-w-0">
      <header className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-2.5">
          <div>
            <h2 className="text-[13px] font-semibold text-s-fg">{title}</h2>
            {desc && <p className={HINT}>{desc}</p>}
          </div>
        </div>
        {action && <div className="flex flex-none items-center gap-1.5 self-start">{action}</div>}
      </header>
      {children ? <div className={`${CARD} ${cardPadding}`}>{children}</div> : null}
      {footer ? <div className={FOOTER}>{footer}</div> : null}
    </section>
  );
}
