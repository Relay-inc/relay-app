import { useState, type ReactNode } from "react";
import { attendees, shownSections, type LinkedNote } from "../../../domain/workspace/linked";
import { noteName } from "../../../domain/navigation/pages";
import { label } from "../../../application/conversations/selectors";
import { select } from "../../../application/navigation/navigation";
import { openPage } from "../../../application/navigation/pages";
import { autoSections } from "../../../application/navigation/sections";
import { dayMonth, sentAt } from "../../../shared/format";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { StageGlyph } from "../today/StageGlyph";

const MEETINGS = 4;
const CARD = 3;
const day = (ymd: string, locale: string) => dayMonth(`${ymd}T12:00:00`, locale);

/** A project's or a context's page under its body, "From links": its meetings, documents, people, open reminders and
 *  conversations, built from what points at it. Read-only, apart from the page; an empty section is not drawn. */
export function LinkedSections({ path }: { path: string }) {
  const { t, locale } = useT();
  const sections = useDerived(() => autoSections(path));
  const [all, setAll] = useState<{ path: string; seen: Set<string> }>({ path, seen: new Set() });
  const seen = all.path === path ? all.seen : new Set<string>();
  if (!sections) return null;
  const { meetings, documents, people, reminders, conversations } = sections;
  if (!shownSections(sections).length) return null;

  const card = (id: string, title: string, count: number, rows: ReactNode[], shown: number, wide = false) =>
    count ? (
      <section aria-label={title} className={`rounded-xl bg-well px-3.5 py-3 ${wide ? "" : "min-w-0"}`}>
        <div className="flex items-center gap-2 mb-1">
          <span className="font-semibold">{title}</span>
          <span className="text-secondary">{count}</span>
          <span className="flex-1" />
          {!seen.has(id) && count > shown ? (
            <button
              className="text-xs text-accent-text hover:underline"
              onClick={() => setAll({ path, seen: new Set(seen).add(id) })}
            >
              {t("links.showAll")}
            </button>
          ) : null}
        </div>
        {rows}
      </section>
    ) : null;
  const upTo = (id: string, list: unknown[], shown: number) => (seen.has(id) ? list.length : shown);
  const row = (key: string, name: string, meta: string, onClick?: () => void, soon = false) => (
    <button
      key={key}
      disabled={!onClick}
      className="w-full flex items-center gap-2 h-7.5 border-t border-separator text-left enabled:hover:text-accent-text"
      onClick={onClick}
    >
      <span className="flex-1 min-w-0 truncate">{name}</span>
      <span className={`text-xs whitespace-nowrap ${soon ? "text-soon" : "text-secondary"}`}>{meta}</span>
    </button>
  );
  const notes = (id: string, list: LinkedNote[], meta: (note: LinkedNote) => string) =>
    list
      .slice(0, upTo(id, list, CARD))
      .map(note => row(note.p, note.t || noteName(note.p), meta(note), () => openPage(note.p)));

  return (
    <section aria-label={t("links.title")} className="flex flex-col gap-2.5" data-from-links>
      <div className="flex items-center gap-2.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-secondary">{t("links.title")}</span>
        <span className="flex-1 h-px bg-separator" />
        <span className="text-xs text-secondary">{t("links.note")}</span>
      </div>
      {card(
        "meetings",
        t("pages.linked.meetings"),
        meetings.length,
        [
          <table key="table" className="w-full">
            <tbody>
              {meetings.slice(0, upTo("meetings", meetings, MEETINGS)).map(note => (
                <tr key={note.p} className="h-8 border-t border-separator">
                  <td className="w-24 text-secondary tabular-nums">{note.date ? day(note.date, locale) : ""}</td>
                  <td className="w-5.5 text-accent-text">
                    {note.stage ? <StageGlyph glyph={{ stage: note.stage, followed: false }} /> : null}
                  </td>
                  <td className="truncate max-w-0">
                    <button className="font-medium text-left hover:text-accent-text" onClick={() => openPage(note.p)}>
                      {note.t || noteName(note.p)}
                    </button>
                  </td>
                  <td className="w-55 text-right text-secondary whitespace-nowrap">{attendees(note)}</td>
                </tr>
              ))}
            </tbody>
          </table>,
        ],
        MEETINGS,
        true,
      )}
      <div className="grid grid-cols-2 gap-2.5">
        {card(
          "documents",
          t("pages.linked.documents"),
          documents.length,
          notes("documents", documents, note => dayMonth(new Date(note.at * 1000).toISOString(), locale)),
          CARD,
        )}
        {card(
          "people",
          t("pages.linked.people"),
          people.length,
          notes("people", people, note => note.role),
          CARD,
        )}
        {card(
          "reminders",
          t("links.reminders"),
          reminders.length,
          reminders
            .slice(0, upTo("reminders", reminders, CARD))
            .map(r => row(r.id, r.title, day(r.date, locale), undefined, r.days <= 2)),
          CARD,
        )}
        {card(
          "conversations",
          t("links.conversations"),
          conversations.length,
          conversations
            .slice(0, upTo("conversations", conversations, CARD))
            .map(chat => row(chat.key, label(chat.key), sentAt(chat.at, locale), () => select(chat.key))),
          CARD,
        )}
      </div>
    </section>
  );
}
