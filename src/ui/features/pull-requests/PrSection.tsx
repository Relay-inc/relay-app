import type { ReactNode } from "react";

/** A titled block of the PR detail: the heading with its count, then the content. */
export function PrSection({
  heading,
  count = "",
  className,
  children,
}: {
  heading: string;
  count?: number | string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <h3 className="text-xs font-semibold text-secondary uppercase tracking-wide mb-1.5 pb-1 border-b border-separator">
        <span>{heading}</span>
        {count !== "" ? (
          <>
            {" "}
            <span className="text-secondary tabular-nums">{count}</span>
          </>
        ) : null}
      </h3>
      {children}
    </div>
  );
}
