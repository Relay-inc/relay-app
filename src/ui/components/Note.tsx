import type { ReactNode } from "react";

/** A muted line: an empty state, a loading text, a change in a feed. `className` adds to its classes. */
export function Note({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`text-secondary mb-3 ${className}`.trim()}>{children}</div>;
}
