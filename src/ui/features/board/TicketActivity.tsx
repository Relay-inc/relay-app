import { useLayoutEffect, useRef, useState } from "react";
import type { CardView, Opt } from "../../../domain/board/types";
import { useT } from "../../hooks/useT";
import { Avatar } from "../../components/Avatar";
import { TicketFiles } from "./TicketFiles";
import { TicketHeading } from "./TicketHeading";
import { when } from "./format";

/** The card's feed, newest first (comments as the provider's cleaned HTML, changes as text), and the comment box:
 *  Cmd-Enter or Comment sends, and what was typed goes once the tracker took it. */
export function TicketActivity({
  feed,
  providerId,
  providerName,
  people = [],
  onComment,
}: {
  feed: CardView["feed"];
  providerId: string;
  providerName: string;
  people?: Opt[]; // who can be mentioned: @ opens them, a pick goes in as "@Name"
  onComment: (text: string, mentions: Opt[]) => Promise<boolean>;
}) {
  const { t, locale } = useT();
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<Opt[]>([]); // the people picked with @ (their "@Name" in the text)
  const [query, setQuery] = useState<string | null>(null); // what follows the @ being typed, null when none
  const [hover, setHover] = useState(0);
  const box = useRef<HTMLTextAreaElement>(null);
  // where the caret goes once a picked name is in the text: set as soon as React put the text in, before the next key
  const caretAfter = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (caretAfter.current === null || !box.current) return;
    box.current.setSelectionRange(caretAfter.current, caretAfter.current);
    caretAfter.current = null;
  }, [text]);
  const send = async () => {
    // only who is still named in the text
    const mentions = picked.filter(p => text.includes(`@${p.name}`));
    if (text.trim() && (await onComment(text, mentions))) {
      setText("");
      setPicked([]);
    }
  };
  // the @ just before the caret, and what is typed after it (a name, so letters, spaces and dots)
  const atCaret = (value: string, caret: number) =>
    /(?:^|\s)@([\p{L}\p{N} .'-]{0,30})$/u.exec(value.slice(0, caret))?.[1] ?? null;
  const matches =
    query === null ? [] : people.filter(p => p.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 6);
  const pick = (person: Opt) => {
    const el = box.current;
    const caret = el?.selectionStart ?? text.length;
    const start = text.slice(0, caret).lastIndexOf("@");
    const next = `${text.slice(0, start)}@${person.name} ${text.slice(caret)}`;
    setText(next);
    setPicked([...picked.filter(p => p.id !== person.id), person]);
    setQuery(null);
    caretAfter.current = start + person.name.length + 2;
    el?.focus();
  };
  return (
    <section className="flex flex-col gap-1">
      <div className="mb-1.5">
        <TicketHeading>{t("kb.activity")}</TicketHeading>
      </div>
      {feed.map((entry, i) => (
        // newest first: counted from the oldest, an entry keeps its key when a new one comes in
        <div key={feed.length - i} className="flex gap-3 py-2">
          <Avatar name={entry.who || providerName} size="size-6 text-[9px]" />
          <div className="flex-1 min-w-0 flex flex-col gap-0.5">
            <div className="flex gap-2 text-xs">
              <b className="font-semibold">{entry.who || providerName}</b>
              <span className="text-tertiary tabular-nums">{when(entry.at, locale)}</span>
            </div>
            {entry.html ? (
              // the provider's HTML after its clean() or its safe Markdown
              <div className="md-panel text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: entry.html }} />
            ) : (
              entry.change && <div className="text-sm text-secondary">{entry.change}</div>
            )}
            {!!entry.files.length && <TicketFiles provider={providerId} files={entry.files} />}
          </div>
        </div>
      ))}
      <div className="relative flex items-center gap-2.5 mt-2 py-2 pl-3.5 pr-2 rounded-xl border border-separator-strong bg-raised">
        {matches.length ? (
          <div className="absolute left-2 bottom-full mb-1 z-20 w-64 p-1 rounded-[10px] bg-raised shadow-xl ring-[0.5px] ring-separator-strong">
            {matches.map((person, i) => (
              <button
                key={person.id}
                onMouseDown={e => {
                  e.preventDefault(); // the textarea keeps the focus and the caret
                  pick(person);
                }}
                className={`w-full flex items-center gap-2 h-8 px-2 rounded-md text-left text-[13px] cursor-pointer ${i === hover ? "bg-fill-2" : ""}`}
              >
                <Avatar name={person.name} size="size-5 text-[8px]" />
                {person.name}
              </button>
            ))}
          </div>
        ) : null}
        <textarea
          ref={box}
          className="flex-1 min-w-0 border-0 outline-none bg-transparent text-sm text-label resize-none p-0"
          rows={1}
          placeholder={people.length ? t("kb.commentPhMention") : t("kb.commentPh")}
          value={text}
          onChange={e => {
            setText(e.target.value);
            setQuery(atCaret(e.target.value, e.target.selectionStart));
            setHover(0);
          }}
          onBlur={() => setQuery(null)}
          onKeyDown={e => {
            if (matches.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
              e.preventDefault();
              setHover((hover + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
              return;
            }
            if (matches.length && (e.key === "Enter" || e.key === "Tab") && !e.metaKey && !e.ctrlKey) {
              e.preventDefault();
              pick(matches[hover] ?? matches[0]);
              return;
            }
            if (matches.length && e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setQuery(null);
              return;
            }
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button
          className="h-7 px-3 rounded-[7px] border-0 bg-fill-2 text-secondary text-xs font-medium hover:text-label"
          onClick={send}
        >
          {t("kb.comment")}
        </button>
      </div>
    </section>
  );
}
