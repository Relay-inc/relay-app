import type { SubCard } from "../../../domain/board/types";
import { useT } from "../../hooks/useT";
import { Ring } from "./Ring";
import { TicketHeading } from "./TicketHeading";
import { numbered } from "./format";

const ROW = "w-full text-left flex items-center gap-2.5 h-10 px-3 border-0 bg-transparent hover:bg-fill cursor-default";

/** The card's subtasks, open and closed, in the tracker's order; a row opens that subtask in the ticket window.
 *  Nothing shows while they are unknown or when there are none. */
export function TicketSubtasks({ subtasks, onOpen }: { subtasks?: SubCard[] | null; onOpen: (id: string) => void }) {
  const { t } = useT();
  if (!subtasks?.length) return null;
  const done = subtasks.filter(s => s.closed).length;
  return (
    <section className="flex flex-col gap-2">
      <TicketHeading>{`${t("kb.subtasks")} · ${done}/${subtasks.length}`}</TicketHeading>
      <div className="flex flex-col border border-separator rounded-[10px] overflow-hidden divide-y divide-separator">
        {subtasks.map(s => (
          <button key={s.id} type="button" className={ROW} onClick={() => onOpen(s.id)}>
            <Ring state={s.state} tone={s.tone} />
            {s.number && <span className="font-mono text-[11px] text-tertiary">{numbered(s.number)}</span>}
            <span className={`flex-1 truncate text-sm ${s.closed ? "text-secondary line-through" : ""}`}>
              {s.title}
            </span>
            {s.who && <span className="text-xs text-secondary whitespace-nowrap">{s.who}</span>}
          </button>
        ))}
      </div>
    </section>
  );
}
