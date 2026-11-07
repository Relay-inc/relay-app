import type { ReactNode } from "react";
import { boardKey, isDerived, lanes, valuesOf, type Row, type View } from "../../../domain/collections/rules";
import { moveCard } from "../../../application/collections/collections";
import { openPage } from "../../../application/navigation/pages";
import { usePointerDrag } from "../../hooks/usePointerDrag";
import { useT } from "../../hooks/useT";
import { dayMonth } from "../../../shared/format";
import { StageGlyph } from "../today/StageGlyph";
import { columnLabel } from "./labels";

/** What the board keeps of a pressed card: which one, where it was grabbed, and the lane it hovers. */
type Grab = { path: string; offsetX: number; offsetY: number; width: number; over?: string };
const laneAt = (e: PointerEvent) =>
  document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-lane]")?.dataset.lane;
const initials = (name: string) =>
  name
    .split(/\s+/)
    .map(w => w.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();

/** The board (K9): lanes of the picked property, a card per note. Dragging a card to a lane writes that value to its
 *  note; a derived property (a meeting's stage) has no moves, its cards only open. */
export function CollectionBoard({ rows, view, today }: { rows: Row[]; view: View; today: string }) {
  const { t, any, locale } = useT();
  const key = boardKey(view);
  const derived = isDerived(view.collection, key);
  const out = lanes(rows, key, view.collection, today);
  const { drag, start } = usePointerDrag<Grab>({
    onMove: (_, e) => ({ over: laneAt(e) }),
    onEnd: (press, released) => {
      if (!released) return;
      const row = rows.find(r => r.p === press.path);
      if (!row) return;
      if (!press.moving) openPage(row.p);
      else if (!derived && press.over !== undefined && press.over !== "" && !valuesOf(row, key).includes(press.over))
        void moveCard(row.p, key, press.over);
    },
  });
  const ghost = drag?.moving ? rows.find(r => r.p === drag.path) : undefined;
  const laneName = (value: string) =>
    value === ""
      ? t("coll.noValue", { key })
      : value === "unwrapped"
        ? t("coll.unwrapped")
        : key === "stage"
          ? any(`meet.stageName.${value}`)
          : value;
  const card = (row: Row, extra: ReactNode = null) => (
    <>
      <span className="text-xs text-secondary tabular-nums">
        {row.date ? dayMonth(row.date, locale) : dayMonth(new Date(row.at * 1000).toISOString(), locale)}
      </span>
      <span className="font-medium leading-snug">{row.t}</span>
      <span className="flex">
        {(row.props.with ?? []).map(name => (
          <span
            key={name}
            title={name}
            className="size-5 -mr-1 rounded-full ring-2 ring-raised grid place-items-center text-[8.5px] font-bold bg-fill-2 text-ctx-a"
          >
            {initials(name)}
          </span>
        ))}
      </span>
      {extra}
    </>
  );
  return (
    <div className="flex-1 min-h-0 overflow-auto pt-3.5 pb-4">
      {derived ? (
        <p className="mb-2.5 text-xs text-secondary">{t("coll.derivedHint", { key: columnLabel(any, key) })}</p>
      ) : null}
      <div className="relative flex gap-3 items-start">
        {out.map(lane => {
          const over = !!drag?.moving && drag.over === lane.value && !derived && lane.value !== "";
          return (
            <section
              key={lane.value}
              data-lane={lane.value}
              aria-label={laneName(lane.value)}
              className={`flex-1 min-w-0 select-none rounded-xl bg-well p-2 flex flex-col gap-2 ${over ? "ring-2 ring-accent" : ""}`}
            >
              <div className={`flex items-center gap-1.75 h-6.5 px-1 ${lane.value === "unwrapped" ? "text-soon" : ""}`}>
                {key === "stage" && lane.value ? (
                  <StageGlyph
                    glyph={{
                      stage: (lane.value === "unwrapped" ? "planned" : lane.value) as "planned",
                      followed: false,
                      dashed: lane.value === "unwrapped",
                    }}
                  />
                ) : null}
                <span className="font-semibold">{laneName(lane.value)}</span>
                <span className="text-xs text-secondary">{lane.rows.length}</span>
              </div>
              {lane.rows.map(row => (
                <div
                  key={row.p}
                  data-card={row.p}
                  role="link"
                  tabIndex={0}
                  className={`flex flex-col gap-1.5 px-3 py-2.5 rounded-lg select-none ${derived ? "cursor-pointer" : "cursor-grab"} ${lane.value === "unwrapped" ? "border border-dashed border-accent bg-transparent opacity-50" : "bg-raised border border-separator-strong shadow-card"} ${drag?.moving && drag.path === row.p ? "opacity-40" : ""}`}
                  onPointerDown={e => {
                    if (e.button !== 0) return;
                    const box = e.currentTarget.getBoundingClientRect();
                    start(
                      { clientX: e.clientX, clientY: e.clientY },
                      { path: row.p, offsetX: e.clientX - box.left, offsetY: e.clientY - box.top, width: box.width },
                    );
                  }}
                  onKeyDown={e => e.key === "Enter" && openPage(row.p)}
                >
                  {card(row)}
                </div>
              ))}
            </section>
          );
        })}
        {drag && ghost && !derived ? (
          <div
            aria-hidden="true"
            className="fixed z-30 pointer-events-none flex flex-col gap-1.5 px-3 py-2.5 rounded-lg bg-raised border border-accent shadow-lg -rotate-3"
            style={{ left: drag.x - drag.offsetX, top: drag.y - drag.offsetY, width: drag.width }}
          >
            {card(
              ghost,
              drag.over !== undefined && drag.over !== "" ? (
                <span className="text-[11.5px] text-accent-text">
                  {t("coll.drop", { key, value: laneName(drag.over) })}
                </span>
              ) : null,
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
