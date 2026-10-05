/** A segmented control (the `seg` utility): one choice of a few, as radio buttons. */
export function Segmented<T extends string>({
  options,
  value,
  label,
  className = "",
  onPick,
}: {
  options: readonly (readonly [T, string])[];
  value: T;
  label?: string;
  className?: string;
  onPick: (value: T) => void;
}) {
  return (
    <div className={`seg ${className}`} role="radiogroup" aria-label={label}>
      {options.map(([id, name]) => (
        <button
          key={id}
          role="radio"
          aria-checked={value === id}
          className={value === id ? "on" : ""}
          onClick={() => onPick(id)}
        >
          {name}
        </button>
      ))}
    </div>
  );
}
