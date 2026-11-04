import type { Toast as ToastState } from "../../../domain/navigation/views";

/** A chip that hugs its text: what just happened and, when it can be taken back, a ghost Undo. */
export function Toast({ toast }: { toast: ToastState }) {
  return (
    <div
      className={`mx-auto flex w-fit max-w-full gap-3 rounded-[10px] bg-label pr-1.5 pl-3.5 text-[13px] text-bg shadow-lg select-none ${toast.detail ? "min-h-9 items-start py-2" : "h-9 items-center py-0"}`}
    >
      {toast.detail ? (
        <span
          aria-hidden="true"
          className="mt-px grid size-4.5 flex-none place-items-center rounded-full bg-del-fg text-xs font-bold text-on-accent"
        >
          !
        </span>
      ) : null}
      {toast.detail ? (
        <span role="alert" className="flex min-w-0 flex-col leading-snug">
          <span className="font-semibold">{toast.text}</span>
          <span className="text-xs opacity-70">{toast.detail}</span>
        </span>
      ) : (
        <span className="truncate">{toast.text}</span>
      )}
      {toast.undo ? (
        <button
          className="h-6.5 cursor-pointer rounded-md border-0 bg-transparent px-2.5 text-xs font-semibold text-bg opacity-85 hover:bg-bg/15"
          onClick={toast.undo}
        >
          {toast.btn}
        </button>
      ) : null}
    </div>
  );
}
