import { memo, useState } from "react";
import type { Item } from "../../../domain/conversations/types";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";
import { ConversationItem } from "./ConversationItem";

/** The tool calls between two messages, folded into one line ("3 steps") that opens to list them. It stays open while
 *  a step runs or failed, so what the agent is doing shows. Memoised on the steps one by one: the list is grouped anew
 *  on every delta, but a group whose steps kept their identity does not redraw. */
export const ToolGroup = memo(
  function ToolGroup({ steps }: { steps: Item[] }) {
    const { tn } = useT();
    const [open, setOpen] = useState(false);
    const shown = open || steps.some(step => step.state === "run" || step.state === "err");
    return (
      <div className="-my-1">
        <button
          className="inline-flex items-center gap-1.5 h-6 cursor-pointer px-1.5 -ml-1.5 border-0 rounded-md bg-transparent text-xs text-secondary hover:bg-fill hover:text-label"
          aria-expanded={shown}
          onClick={() => setOpen(!open)}
        >
          <Icon
            name="right"
            className={`glyph size-3 stroke-2 transition-transform duration-150 ${shown ? "rotate-90" : ""}`}
          />
          {tn("steps", steps.length)}
        </button>
        <div className={`flex-col gap-0.5 ml-1.25 pl-3 border-l border-separator-strong ${shown ? "flex" : "hidden"}`}>
          {/* append-only, so a step's index in the group is stable */}
          {steps.map((step, i) => (
            <ConversationItem key={step.id ?? i} item={step} />
          ))}
        </div>
      </div>
    );
  },
  (before, after) =>
    before.steps.length === after.steps.length && before.steps.every((step, i) => step === after.steps[i]),
);
