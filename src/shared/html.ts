const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
/** Text made safe to put in markup. */
export const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, char => ESCAPES[char]);
