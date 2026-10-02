import type { ReactNode } from "react";

/** A popover under a toolbar button, right-aligned: a clear layer over the page closes it on a click outside. */
export function BoardPopover({
  width,
  onClose,
  children,
}: {
  width: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose}></div>
      <div
        className={`absolute top-full right-0 mt-1.5 z-20 ${width} rounded-xl bg-raised shadow-md ring-1 ring-separator-strong`}
      >
        {children}
      </div>
    </>
  );
}
