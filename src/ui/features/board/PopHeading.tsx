/** A small heading over a popover's rows. */
export function PopHeading({ children }: { children: string }) {
  return (
    <div className="px-2 pt-1.5 pb-1 text-[11px] font-semibold tracking-wider uppercase text-tertiary">{children}</div>
  );
}
