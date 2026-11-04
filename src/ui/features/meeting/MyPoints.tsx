import { useState } from "react";
import { briefingIn } from "../../../domain/calendar/rules";
import { pointsIn } from "../../../domain/calendar/meeting-view";
import type { Meeting } from "../../../domain/calendar/types";
import { toggleBriefingTask } from "../../../application/calendar/meeting-view";
import { Icon } from "../../components/Icon";
import { useT } from "../../hooks/useT";

/** The `- [ ]` points under "My points" in the note's briefing, above the notes: ticking one writes it back into the
 *  briefing. Nothing when the briefing has none. */
export function MyPoints({ meeting, note }: { meeting: Meeting; note: string }) {
  const { t } = useT();
  const [open, setOpen] = useState(true);
  const points = pointsIn(briefingIn(note) ?? "");
  if (!points.length) return null;
  return (
    <div className="flex-none mb-3 px-3 py-2 rounded-lg border border-separator">
      <button
        aria-expanded={open}
        className="flex items-center gap-2 w-full h-6.5 font-semibold cursor-pointer"
        onClick={() => setOpen(!open)}
      >
        <Icon name="down" className={`glyph size-2.75 text-secondary ${open ? "" : "-rotate-90"}`} />
        {t("meet.points")}
        <span className="font-normal text-xs text-secondary">
          {points.filter(point => point.done).length} / {points.length}
        </span>
      </button>
      {open ? (
        <div className="flex flex-col gap-1 pl-4.75 mt-0.5">
          {points.map(point => (
            <label
              key={point.n}
              className={`flex items-center gap-2 cursor-pointer ${point.done ? "text-secondary" : ""}`}
            >
              <input
                type="checkbox"
                checked={point.done}
                className="size-3.5 accent-accent"
                onChange={() => void toggleBriefingTask(meeting, point.n)}
              />
              <span className={point.done ? "line-through" : ""}>{point.text}</span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}
