/** A vault context's colour, "" for no project (domain/navigation/sidebar.ts CONTEXT_TINTS). */
export type Tint = "" | "ctx-a" | "ctx-m" | "ctx-p";
// literal classes, so Tailwind finds them
const TEXT = { "ctx-a": "text-ctx-a", "ctx-m": "text-ctx-m", "ctx-p": "text-ctx-p" } as const;
/** A context's text colour class; `none` for no project. */
export const tintText = (tint: Tint, none = "text-tertiary") => (tint ? TEXT[tint] : none);
