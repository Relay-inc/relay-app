import { html, nothing } from "lit";
import { currentLocale } from "../../core/i18n";
import { icon } from "../../core/icons";
import type { State } from "../../domain/providers";

/** The status ring: todo an outline, doing the top half, done filled with a tick. Without a known state nothing is drawn. */
export function ring(state?: State) {
  if (!state) return nothing;
  const look =
    state === "done"
      ? "bg-ok border-ok text-bg"
      : state === "doing"
        ? "border-soon border-b-transparent border-l-transparent"
        : "border-tertiary";
  return html`<span
    class="size-3.5 flex-none box-border rounded-full border-2 rotate-45 grid place-items-center ${look}"
    >${state === "done" ? icon("check", "glyph size-2.5 -rotate-45 stroke-3") : nothing}</span
  >`;
}

// a person's circle from their (first) name; the colour is picked by the name, so it stays the same
const TINTS = ["bg-accent-soft text-accent-text", "bg-fill-2 text-ctx-p", "bg-fill-2 text-ctx-m"];
export function avatar(name: string, size = "size-5 text-[9px]") {
  if (!name) return nothing;
  const tint = TINTS[[...name].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % TINTS.length];
  return html`<span class="${size} flex-none rounded-full grid place-items-center font-semibold ${tint}" title=${name}
    >${name.slice(0, 2).toUpperCase()}</span
  >`;
}

const DAY = 864e5;
const day = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
};
/** A due day (yyyy-mm-dd): 3/10 short, "Sat 3 Oct" long, red when past, orange up to tomorrow. */
export function due(iso: string | null | undefined, now = new Date()) {
  if (!iso) return null;
  const at = day(iso);
  const left = Math.round((at.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / DAY);
  return {
    short: `${at.getDate()}/${at.getMonth() + 1}`,
    long: at.toLocaleDateString(currentLocale(), { weekday: "short", day: "numeric", month: "short" }),
    tone: left < 0 ? "text-late" : left <= 1 ? "text-soon" : "text-secondary",
  };
}
/** The last update as "Sep 29". */
export const updated = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString(currentLocale(), { day: "numeric", month: "short" }) : "";
