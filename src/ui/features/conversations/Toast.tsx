import type { Toast as ToastState } from "../../../domain/navigation/views";

/** A chip that hugs its text: what just happened and, when it can be taken back, a ghost Undo. */
export function Toast({ toast }: { toast: ToastState }) {
  return (
    <div
      className={`mx-auto flex h-9 w-fit max-w-full items-center gap-3 rounded-[10px] bg-label py-0 pr-1.5 pl-3.5 text-[13px] text-bg shadow-lg select-none`}
    >
      <span className="truncate">{toast.text}</span>
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
