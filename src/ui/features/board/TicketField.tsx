import type { ReactNode } from "react";

/** A field in the ticket window's sidebar: its label above, the value below. */
export function TicketField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 px-2 py-1.5">
      <span className="text-xs text-secondary">{label}</span>
      {children}
    </div>
  );
}
