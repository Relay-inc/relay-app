import type { ReactNode } from "react";

/** The window over a view (the board's task): a dim backdrop and the 960x700 card on it, with the header and body as
 *  its children. A click on the backdrop asks to close (`onClose`). `acting`: an action is running, so the card is
 *  dimmed and takes no clicks. */
export function Modal({
  acting = false,
  onClose,
  children,
}: {
  acting?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30" onClick={onClose}>
      <div
        className={`w-240 max-w-[calc(100vw-48px)] h-175 max-h-[calc(100vh-48px)] flex flex-col bg-bg rounded-2xl shadow-md ring-1 ring-separator-strong overflow-hidden ${acting ? "opacity-70" : ""}`}
        inert={acting}
        onClick={e => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
