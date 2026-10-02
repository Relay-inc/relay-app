import type { ReactNode } from "react";
import type { Opt } from "../../../domain/board/types";
import { Select } from "../../components/Select";

const PILL = "inline-flex self-start items-center gap-2 h-6.5 px-2 -ml-2 rounded-[7px] text-[13px]";

/** The value as a pill that opens the browser's own list over it when there are choices, else plain. `none` is the
 *  label of an empty choice (unassigned). */
export function TicketPicker({
  current,
  choices,
  none,
  label,
  onPick,
  children,
}: {
  current: string;
  choices: Opt[] | undefined;
  none?: string;
  label: string;
  onPick: (id: string) => void;
  children: ReactNode;
}) {
  if (!choices) return <span className={`${PILL} font-medium`}>{children}</span>;
  return (
    <label className={`${PILL} relative font-medium hover:bg-fill-2`}>
      {children}
      <Select
        className="absolute inset-0 opacity-0 w-full"
        aria-label={label}
        options={choices}
        value={current}
        empty={none}
        onChange={onPick}
      />
    </label>
  );
}
