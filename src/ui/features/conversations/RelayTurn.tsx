import { useState } from "react";
import { relayText } from "../../../domain/orchestrator/rules";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";
import { Markdown } from "../../components/Markdown";

/** A turn Relay wrote itself (a worker's brief, a report into the coordinator), not the user's bubble: folded to
 *  "From Relay" and its first line, a click opens the whole text. */
export function RelayTurn({ text }: { text: string }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const body = relayText(text);
  // Relay writes its reports line by line (a diff stat, a branch): every line break stays one
  const lines = body.replace(/\n(?!\n)/g, "  \n");
  return (
    <div className="rounded-[10px] border border-separator text-[13px]">
      <button
        className="flex w-full items-center gap-2 h-8 px-3 border-0 bg-transparent text-left cursor-default text-secondary hover:text-label"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon
          name="right"
          className={`glyph size-3 flex-none stroke-2 transition-transform duration-150 ${open ? "rotate-90" : ""}`}
        />
        <span className="flex-none font-medium text-label">{t("orch.fromRelay")}</span>
        {open ? null : <span className="flex-1 min-w-0 truncate">{body.split("\n")[0]}</span>}
      </button>
      {open ? (
        <Markdown
          className="md-chat [&_a:not(.vlink)]:underline text-sm! leading-normal! px-3 pb-3 select-text"
          text={lines}
        />
      ) : null}
    </div>
  );
}
