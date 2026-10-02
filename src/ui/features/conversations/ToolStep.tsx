import { useState } from "react";
import type { Item } from "../../../domain/conversations/types";
import { noteKey } from "../../../domain/navigation/keys";
import { notePath } from "../../../application/workspace/vault";
import { openDetail } from "../../../application/navigation/panel";
import { useDerived } from "../../hooks/useDerived";
import { Icon } from "../../components/Icon";
import { ToolLine } from "../../components/ToolLine";
import { Highlighted } from "../../components/Highlighted";
import { changeOf, hunkRows } from "../../components/tool-change";

// the icon before the line: what kind of call it is, a spinner while it runs
const kindOf = (name: string) =>
  /^(Edit|MultiEdit|Write)$/.test(name)
    ? "edit"
    : /^(Grep|Glob|WebSearch)$/.test(name)
      ? "search"
      : name === "Bash"
        ? "term"
        : "file";

/** One tool call, a line with its icon, and the change it made when the call carries one. A Read or Edit on a note
 *  that exists opens it in the right panel; a command opens in full under its line. */
export function ToolStep({ item }: { item: Item }) {
  // re-read when the notes index changes, so a note written later links
  const note = useDerived(() => notePath(item.path));
  const [open, setOpen] = useState(false);
  const tool = item.tool;
  const change = tool ? changeOf(tool.name, tool.input) : null;
  const command = tool?.name === "Bash" ? String(tool.input?.command || "") : "";
  // the provider's patch has line numbers and context; without one, the old and new text from the call
  const rows = item.hunks?.length ? hunkRows(item.hunks) : null;
  const lines = item.hunks?.flatMap(hunk => hunk.lines) ?? [];
  const added = rows ? lines.filter(l => l[0] === "+").length : change?.add.length;
  const removed = rows ? lines.filter(l => l[0] === "-").length : change?.del.length;
  const width = `${String(Math.max(0, ...(rows ?? []).map(r => ("n" in r ? r.n : 0)))).length}ch`;
  const cls = `flex items-center gap-2 h-6 min-w-0 text-[13px] [&_code]:whitespace-nowrap [&_code]:font-mono [&_code]:text-xs [&_code]:bg-fill-2 [&_code]:text-label [&_code]:px-1.25 [&_code]:py-px [&_code]:rounded-sm ${item.state === "err" ? "text-label" : "text-secondary"}`;
  const line = (
    <>
      {item.state === "run" ? (
        <span className="spinner"></span>
      ) : (
        <Icon name={kindOf(tool?.name ?? "")} className="glyph size-3.5 flex-none" />
      )}
      <span className="min-w-0 truncate">
        {tool ? <ToolLine name={tool.name} input={tool.input} linked={!!note} /> : item.text}
      </span>
      {added ? <span className="font-mono text-[11px] text-add-fg">+{added}</span> : null}
      {removed ? <span className="font-mono text-[11px] text-del-fg">−{removed}</span> : null}
    </>
  );
  // the tool call carries the old and new text, not where they sit in the file: rows without line numbers
  const row = (sign: string, text: string, colour: string, i: number) => (
    <div key={i} className={`px-3 whitespace-pre-wrap wrap-anywhere ${colour}`}>
      {sign} {text}
    </div>
  );
  const COLOUR = { " ": "text-tertiary", "-": "bg-del-bg text-del-fg", "+": "bg-add-bg text-add-fg" };
  const box =
    "mt-1 mb-1.5 border border-separator rounded-lg overflow-hidden font-mono text-xs leading-[1.7] max-h-120 overflow-y-auto";
  return (
    <div>
      {note ? (
        <button
          className={`${cls} w-full text-left cursor-pointer hover:underline`}
          onClick={() => openDetail(noteKey(note))}
        >
          {line}
        </button>
      ) : command ? (
        <button
          className={`${cls} w-full text-left cursor-pointer hover:text-label`}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {line}
        </button>
      ) : (
        <div className={cls}>{line}</div>
      )}
      {open && command ? (
        <pre className="my-1 px-3 py-2 bg-well border border-separator rounded-lg font-mono text-xs leading-[1.6] text-label whitespace-pre-wrap wrap-anywhere select-text max-h-60 overflow-y-auto">
          <Highlighted code={command} lang="bash" />
        </pre>
      ) : null}
      {rows?.length ? (
        <div className={box}>
          {rows.map((r, i) =>
            "gap" in r ? (
              <div key={i} className="px-3 text-tertiary border-y border-separator bg-fill" aria-hidden>
                ⋯
              </div>
            ) : (
              <div key={i} className={`flex gap-3 px-3 ${COLOUR[r.sign]}`}>
                <span className="flex-none text-right select-none" style={{ width }}>
                  {r.n}
                </span>
                <span className="min-w-0 whitespace-pre-wrap wrap-anywhere">
                  {r.sign === "-" ? "−" : r.sign === "+" ? "+" : " "} {r.text}
                </span>
              </div>
            ),
          )}
        </div>
      ) : change && (change.del.length || change.add.length) ? (
        <div className={box}>
          {change.del.map((text, i) => row("−", text, "bg-del-bg text-del-fg", i))}
          {change.add.map((text, i) => row("+", text, "bg-add-bg text-add-fg", change.del.length + i))}
        </div>
      ) : null}
    </div>
  );
}
