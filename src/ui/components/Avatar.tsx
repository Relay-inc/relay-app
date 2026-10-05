// a person's circle with their initials: two letters of a full name ("Laurent Meersman" LM), the first two of one word.
// `self`: the board knows whether it is the user, who gets the accent and the others the two context tints. Without
// it the colour is picked by the name among the three, so it stays the same
const TINTS = ["bg-accent-soft text-accent-text", "bg-fill-2 text-ctx-p", "bg-fill-2 text-ctx-m"];
const sum = (name: string) => [...name].reduce((total, ch) => total + ch.charCodeAt(0), 0);

export function Avatar({ name, size = "size-5 text-[9px]", self }: { name: string; size?: string; self?: boolean }) {
  if (!name) return null;
  const words = name.trim().split(/\s+/);
  const initials = words.length > 1 ? `${words[0][0]}${words[words.length - 1][0]}` : name.slice(0, 2);
  const tint = self ? TINTS[0] : self === false ? TINTS[1 + (sum(name) % 2)] : TINTS[sum(name) % TINTS.length];
  return (
    <span className={`${size} flex-none rounded-full grid place-items-center font-semibold ${tint}`} title={name}>
      {initials.toUpperCase()}
    </span>
  );
}
