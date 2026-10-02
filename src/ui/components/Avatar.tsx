// a person's circle from their (first) name; the colour is picked by the name, so it stays the same
const TINTS = ["bg-accent-soft text-accent-text", "bg-fill-2 text-ctx-p", "bg-fill-2 text-ctx-m"];

export function Avatar({ name, size = "size-5 text-[9px]" }: { name: string; size?: string }) {
  if (!name) return null;
  const tint = TINTS[[...name].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % TINTS.length];
  return (
    <span className={`${size} flex-none rounded-full grid place-items-center font-semibold ${tint}`} title={name}>
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}
