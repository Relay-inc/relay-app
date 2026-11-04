import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { noteName } from "../../../domain/navigation/pages";
import { headingAt, outlineOf, type RailNote } from "../../../domain/workspace/rail";
import { select } from "../../../application/navigation/navigation";
import { openPageAtLine, openPageIn, revealLine } from "../../../application/navigation/pages";
import { linkUnlinked, railConversations, railKey, railNote, useRailStore } from "../../../application/navigation/rail";
import { clockTime } from "../../../shared/format";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";
import type { CommentsApi } from "./PageEditor";

const INDENT = ["pl-2", "pl-2", "pl-2", "pl-5", "pl-8", "pl-11", "pl-14"]; // by heading level

/** A page's right rail (the K2 design): the outline of its headings, who links to it, where its name stands without a
 *  link, what is near it and which conversations used it. Read-only apart from Link on a mention. `scroller` is what
 *  the page scrolls in and `api` its editor, which tell the outline where the page is. */
export function Rail({
  target,
  text,
  api,
  scroller,
}: {
  target: string;
  text: string;
  api: RefObject<CommentsApi | null>;
  scroller: RefObject<HTMLElement | null>;
}) {
  const { t, locale } = useT();
  const { folder, path } = railNote(target);
  const data = useRailStore(s => s.by[railKey(folder, path)]);
  const conversations = useDerived(() => railConversations(folder, path));
  const name = noteName(path);
  const open = (note: { p: string }, line = 0) =>
    line ? openPageAtLine(folder, note.p, line) : openPageIn(folder, note.p);

  const noteRow = (note: RailNote, mention: boolean) => (
    <div key={note.p} className="flex flex-col gap-0.5 px-2 py-1.5">
      <div className="flex items-center gap-2">
        <button
          className="flex-1 min-w-0 truncate text-left text-sm font-medium hover:text-accent-text"
          onClick={() => void open(note, note.line)}
        >
          {note.t}
        </button>
        <span className="text-xs text-secondary whitespace-nowrap">{note.k}</span>
        {mention ? (
          <button
            className="h-5 px-1.5 rounded-sm border border-separator-strong text-xs font-medium hover:bg-fill"
            aria-label={t("rail.linkIn", { hit: note.hit, note: note.t })}
            onClick={() => void linkUnlinked(folder, path, note, name)}
          >
            {t("rail.link")}
          </button>
        ) : null}
      </div>
      <button
        className="text-left text-xs leading-snug text-secondary text-pretty"
        onClick={() => void open(note, note.line)}
      >
        {note.before}
        <mark className="rounded-sm bg-accent-soft px-0.5 text-accent-text">{note.hit}</mark>
        {note.after}
      </button>
    </div>
  );
  const plainRow = (note: { p: string; t: string; k: string }) => (
    <button
      key={note.p}
      className="flex items-center gap-2 px-2 py-1 text-left text-sm hover:text-accent-text"
      onClick={() => void open(note)}
    >
      <span className="flex-1 min-w-0 truncate">{note.t}</span>
      <span className="text-xs text-secondary whitespace-nowrap">{note.k}</span>
    </button>
  );

  return (
    <aside
      aria-label={t("rail.title")}
      data-rail
      className="w-75 flex-none flex flex-col gap-1 border-l border-separator px-3.5 py-3 overflow-y-auto"
    >
      <Outline target={target} text={text} api={api} scroller={scroller} />
      <Section title={t("rail.backlinks")} count={data?.backlinks.length ?? 0} id="backlinks">
        {data?.backlinks.map(note => noteRow(note, false))}
      </Section>
      <Section title={t("rail.unlinked")} count={data?.mentions.length ?? 0} id="unlinked">
        {data?.mentions.map(note => noteRow(note, true))}
      </Section>
      <Section title={t("rail.related")} count={data?.related.length ?? 0} id="related">
        {data?.related.map(plainRow)}
      </Section>
      <Section title={t("rail.conversations")} count={conversations.length} id="conversations">
        {conversations.map(chat => (
          <button
            key={chat.key}
            className="flex items-center gap-2 px-2 py-1 text-left text-sm hover:text-accent-text"
            onClick={() => void select(chat.key)}
          >
            <span className="flex-1 min-w-0 truncate">{chat.label}</span>
            <span className="text-xs text-secondary whitespace-nowrap">
              {t(chat.kind === "write" ? "rail.wrote" : "rail.read", {
                time: clockTime(new Date(chat.at).toISOString(), locale),
              })}
            </span>
          </button>
        ))}
      </Section>
    </aside>
  );
}

/** A section of the rail under its header, which folds it; one with nothing in it is not drawn. */
function Section({
  title,
  count,
  id,
  plain = false,
  children,
}: {
  title: string;
  count: number;
  id: string;
  plain?: boolean; // no count beside the title
  children: ReactNode;
}) {
  const [folded, setFolded] = useState(false);
  if (!count) return null;
  return (
    <section aria-label={title} data-rail-section={id} className="flex flex-col">
      <button
        aria-expanded={!folded}
        className="flex items-center gap-1.5 pt-2 pb-1 px-0.5 text-xs font-semibold uppercase tracking-wide text-secondary"
        onClick={() => setFolded(!folded)}
      >
        <Icon name="down" className={`glyph size-2.5 ${folded ? "-rotate-90" : ""}`} />
        <span className="flex-1 text-left">{title}</span>
        {plain ? null : <span className="font-medium tracking-normal">{count}</span>}
      </button>
      {folded ? null : children}
    </section>
  );
}

/** The page's headings; a click scrolls the page to one, and the one the page is scrolled to is marked. */
function Outline({
  target,
  text,
  api,
  scroller,
}: {
  target: string;
  text: string;
  api: RefObject<CommentsApi | null>;
  scroller: RefObject<HTMLElement | null>;
}) {
  const { t } = useT();
  const outline = outlineOf(text);
  const [seen, setSeen] = useState(-1);
  const jumped = useRef(false); // a click scrolled the page: the scroll it causes does not move the mark, the reader's does
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const update = () => {
      if (jumped.current) return;
      const heads = outlineOf(text);
      // at the very bottom the last heading is the one, however short its section
      if (el.scrollTop > 0 && el.scrollTop + el.clientHeight >= el.scrollHeight - 2) return setSeen(heads.length - 1);
      const line = api.current?.lineAt(el.getBoundingClientRect().top + 48);
      if (line !== undefined) setSeen(headingAt(heads, line));
    };
    update();
    const frame = requestAnimationFrame(update); // the editor may be made after this
    const release = () => {
      jumped.current = false;
    };
    el.addEventListener("scroll", update, { passive: true });
    for (const type of ["wheel", "touchmove", "pointerdown", "keydown"])
      el.addEventListener(type, release, { passive: true });
    return () => {
      for (const type of ["wheel", "touchmove", "pointerdown", "keydown"]) el.removeEventListener(type, release);
      cancelAnimationFrame(frame);
      el.removeEventListener("scroll", update);
    };
  }, [text, api, scroller, jumped]);
  const active = Math.max(seen, 0);
  return (
    <Section title={t("rail.outline")} count={outline.length} id="outline" plain>
      {outline.map((h, i) => (
        <button
          key={h.line}
          aria-current={i === active}
          className={`py-0.75 pr-2 rounded-md text-left text-sm truncate ${INDENT[h.level]} ${
            i === active ? "bg-accent-soft font-medium text-accent-text" : "hover:text-accent-text"
          }`}
          onClick={() => {
            setSeen(i);
            jumped.current = true;
            revealLine(target, h.line, true);
          }}
        >
          {h.title}
        </button>
      ))}
    </Section>
  );
}
