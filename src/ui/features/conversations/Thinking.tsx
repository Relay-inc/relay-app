import { useState } from "react";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";

/** What the agent reasoned before answering: dim, folded to one line until opened. */
export function Thinking({ text }: { text: string }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="-my-1">
      <button
        className="inline-flex items-center gap-1.5 h-6 cursor-pointer px-1.5 -ml-1.5 border-0 rounded-md bg-transparent text-xs text-tertiary hover:bg-fill hover:text-label"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon
          name="right"
          className={`glyph size-3 stroke-2 transition-transform duration-150 ${open ? "rotate-90" : ""}`}
        />
        {t("work.thought")}
      </button>
      <div
        className={`ml-1.25 pl-3 border-l border-separator-strong text-[13px] text-tertiary whitespace-pre-wrap ${open ? "block" : "hidden"}`}
      >
        {text}
      </div>
    </div>
  );
}
