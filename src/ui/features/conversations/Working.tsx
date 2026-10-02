/** The agent is busy: pulsing dots, and what it is doing. `label` is read out by assistive technology. */
export function Working({ text = "", label = "" }: { text?: string; label?: string }) {
  return (
    <div
      className="flex items-center gap-2.5 text-secondary text-sm py-1"
      role={label ? "status" : undefined}
      aria-label={label || undefined}
    >
      <span className="pulse-dots">
        <i></i>
        <i></i>
        <i></i>
      </span>
      {text ? (
        <span className="overflow-hidden whitespace-nowrap text-ellipsis min-w-0 [&_code]:font-mono [&_code]:text-xs">
          {text}
        </span>
      ) : null}
    </div>
  );
}
