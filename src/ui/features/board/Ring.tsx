import type { State, Tone } from "../../../domain/board/types";
import { Icon } from "../../components/Icon";

// a workflow status' colour (board-core's toneOf), or without one the colour of its kind
const TONE: Record<Tone, string> = {
  idle: "border-tertiary",
  planned: "border-ctx-a",
  active: "border-soon",
  blocked: "border-late",
  review: "border-accent",
  done: "border-ok bg-ok",
};
const KIND: Record<State, Tone> = { todo: "idle", doing: "active", done: "done" };

/** The status ring: not started an outline, in progress the top half, done filled with a tick, in the status' colour.
 *  Without a known state nothing is drawn. */
export function Ring({ state, tone }: { state?: State; tone?: Tone }) {
  if (!state) return null;
  const look = `${TONE[state === "done" ? "done" : (tone ?? KIND[state])]} ${state === "doing" ? "border-b-transparent border-l-transparent" : ""}`;
  return (
    <span
      className={`size-3.5 flex-none box-border rounded-full border-[1.6px] rotate-45 grid place-items-center text-bg ${look}`}
    >
      {state === "done" && <Icon name="check" className="glyph size-[9px] -rotate-45 stroke-[3.2]" />}
    </span>
  );
}
