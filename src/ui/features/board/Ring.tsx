import type { State } from "../../../domain/board/types";
import { Icon } from "../../components/Icon";

/** The status ring: todo an outline, doing the top half, done filled with a tick. Without a known state nothing is drawn. */
export function Ring({ state }: { state?: State }) {
  if (!state) return null;
  const look =
    state === "done"
      ? "bg-ok border-ok text-bg"
      : state === "doing"
        ? "border-soon border-b-transparent border-l-transparent"
        : "border-tertiary";
  return (
    <span className={`size-3.5 flex-none box-border rounded-full border-2 rotate-45 grid place-items-center ${look}`}>
      {state === "done" && <Icon name="check" className="glyph size-2.5 -rotate-45 stroke-3" />}
    </span>
  );
}
