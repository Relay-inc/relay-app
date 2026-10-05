/** A section heading in the ticket window. */
export function TicketHeading({ children }: { children: string }) {
  return <h3 className="m-0 text-[11px] font-semibold tracking-wider uppercase text-tertiary">{children}</h3>;
}
