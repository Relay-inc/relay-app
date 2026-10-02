import type { ReactNode } from "react";

/** A section of the card panel: its title, a count when there is one, and its body. */
export function CardSection({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="mt-4">
      <h3 className="text-xs font-semibold text-secondary uppercase tracking-wide mb-1.5 pb-1 border-b border-separator">
        {title}
        {count !== undefined && (
          <>
            {" "}
            <span className="text-secondary tabular-nums">{count}</span>
          </>
        )}
      </h3>
      {children}
    </section>
  );
}
