import type { ReactNode } from "react";

/** The window over a view (the board's task): a dim backdrop and the 960x700 card on it (its shadow: board.css), with the header and body as
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
    // only a click on the backdrop itself closes: clicks inside go on to the document, which opens links
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[rgba(10,10,14,.32)]"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`w-240 max-w-[calc(100vw-48px)] h-175 max-h-[calc(100vh-48px)] ticket-window flex flex-col bg-bg rounded-[14px] overflow-hidden ${acting ? "opacity-70" : ""}`}
        inert={acting}
      >
        {children}
      </div>
    </div>
  );
}
