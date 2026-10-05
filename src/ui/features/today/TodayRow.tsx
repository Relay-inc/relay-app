import type { ReactNode } from "react";
import { Icon } from "../../components/Icon";
import { tintText } from "../../../shared/tints";
import type { Section } from "../../../domain/navigation/sidebar";

// small outline buttons and icon buttons, as a reminder's row has them
export const ROW_BUTTON =
  "btn h-6.5! px-2.25! rounded-[7px]! text-xs! font-medium whitespace-nowrap cursor-pointer disabled:opacity-50";
export const ROW_PRIMARY = `${ROW_BUTTON} btn-primary`;

/** One item under Today that is not a reminder: its glyph, the title (a click opens it), the project in its context's
 *  colour and what else there is to know, then the actions. */
export function TodayRow({
  icon,
  iconClass = "text-secondary",
  title,
  onOpen,
  project,
  tint,
  meta,
  actions,
  dim = false,
}: {
  icon: string;
  iconClass?: string;
  title: string;
  onOpen: () => void;
  project?: string; // the project as it is shown, "" for none
  tint?: Section["tint"];
  meta?: ReactNode;
  actions?: ReactNode;
  dim?: boolean; // over: a meeting that ended
}) {
  return (
    <div className={`flex items-center gap-3 py-2.5 border-b border-separator ${dim ? "opacity-55" : ""}`}>
      <span className={`size-5 flex-none grid place-items-center ${iconClass}`}>
        <Icon name={icon} className="glyph size-3.75" />
      </span>
      <div className="min-w-0 flex-1">
        <button
          className="block max-w-full text-left text-[14px] leading-[1.4] truncate cursor-pointer hover:underline"
          onClick={onOpen}
        >
          {title}
        </button>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-secondary mt-0.5">
          {project ? (
            <span className="inline-flex items-center gap-1">
              <Icon name="folder" className={`glyph size-3 ${tintText(tint ?? "")}`} />
              {project}
            </span>
          ) : null}
          {meta}
        </div>
      </div>
      {actions ? <div className="flex items-center gap-1">{actions}</div> : null}
    </div>
  );
}

/** A section's heading with its count, as the reminders view has them. */
export function TodayHeading({
  children,
  n,
  tone = "text-tertiary",
}: {
  children: ReactNode;
  n: number;
  tone?: string;
}) {
  return (
    <h2
      className={`flex items-baseline gap-1.5 pb-2 border-b border-separator text-[11px] font-semibold uppercase tracking-[0.06em] ${tone}`}
    >
      {children} <span className="text-tertiary tabular-nums">{n}</span>
    </h2>
  );
}
