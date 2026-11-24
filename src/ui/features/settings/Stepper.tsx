/** A number with − and + beside it, kept between `min` and `max`. */
export function Stepper({
  value,
  min,
  max,
  label,
  fewer,
  more,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  label: string;
  fewer: string;
  more: string;
  onChange: (value: number) => void;
}) {
  const button =
    "grid h-full w-7.5 place-items-center text-[15px] text-s-muted hover:text-s-fg disabled:opacity-40 focus-visible:ring-1 ring-s-primary focus-visible:outline-none";
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex h-7.5 flex-none items-center self-start rounded-lg border border-s-input"
    >
      <button className={button} aria-label={fewer} disabled={value <= min} onClick={() => onChange(value - 1)}>
        −
      </button>
      <span className="min-w-6 text-center tabular-nums" aria-live="polite">
        {value}
      </span>
      <button className={button} aria-label={more} disabled={value >= max} onClick={() => onChange(value + 1)}>
        +
      </button>
    </div>
  );
}
