import { useState } from "react";
import { noteOf } from "../../../shared/markdown";
import { dateFormat } from "../../../shared/format";
import { panelItem } from "../../../domain/navigation/keys";
import { useNavigationStore } from "../../../application/navigation/store";
import { closeDrawer } from "../../../application/navigation/panel";
import { copy } from "../../../application/navigation/navigation";
import { noteKnown, openNote } from "../../../application/workspace/vault";
import { settings } from "../../../application/settings/settings";
import { noteLinks, noteProperties, noteTitle } from "../../../domain/workspace/rules";
import { useWorkspaceStore } from "../../../application/workspace/store";
import { useT } from "../../hooks/useT";
import { Markdown } from "../../components/Markdown";
import { Icon } from "../../components/Icon";
import { Note } from "../../components/Note";

type NoteText = { path: string; text: string };

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?/;
// shown above the body, not among the properties
const LEAD = ["description", "title"];

/** A vault note in the right drawer as a document: one bar (where it lives, copy, open, close), the title and its
 *  description, the frontmatter folded into one quiet line, the body, then the notes it links to. Links open the next
 *  note (ui/app handles `data-note`, the frontmatter's [[links]] and the linked notes use it too). */
export function NoteDetail({ panelKey }: { panelKey: string }) {
  const { t, locale } = useT();
  const note = useNavigationStore(s => s.panel.detail[panelKey]) as NoteText | undefined;
  const err = useNavigationStore(s => s.panel.err);
  // which notes exist: the frontmatter's links and the linked notes follow it
  const index = useWorkspaceStore(s => s.notes);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const item = panelItem(panelKey);
  const path = note?.path ?? (item?.kind === "note" ? item.target : "");

  const match = note ? FRONTMATTER.exec(note.text) : null;
  const properties = match ? noteProperties(match[1]) : [];
  const prop = (key: string) => properties.find(([k]) => k === key)?.[1][0] ?? "";
  const { title, body } = noteTitle(path, note ? note.text.slice(match ? match[0].length : 0) : "");
  const day = prop("created") || prop("date");
  const date = /^\d{4}-\d{2}-\d{2}/.test(day)
    ? dateFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(day))
    : "";
  const summary = [prop("type"), linkLabel(prop("context")), date].filter(Boolean);
  const links = note ? noteLinks(index, settings().vault, path, note.text) : [];

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* app chrome is not text: no selection in the bar, like a native Mac app */}
      <div
        className="h-12 flex-none flex items-center gap-1 pl-4 pr-2.5 border-b border-separator select-none"
        data-tauri-drag-region
      >
        <Icon name="file" className="glyph size-3.75 text-tertiary" />
        {/* where the note lives: the last two folders, the whole path on hover */}
        <div
          title={path}
          className="flex-1 min-w-0 flex items-center gap-1.25 ml-1.5 text-[13px] text-tertiary whitespace-nowrap overflow-hidden"
        >
          <span>Vault</span>
          {path
            .split("/")
            .slice(0, -1)
            .slice(-2)
            .map((folder, i, shown) => (
              <span key={i} className="contents">
                <Icon name="right" className="glyph size-3 flex-none" />
                <span className={i === shown.length - 1 ? "text-secondary" : undefined}>{folder}</span>
              </span>
            ))}
        </div>
        {note ? (
          <>
            <button
              className="btn-icon"
              title={t("note.copyPath")}
              aria-label={t("note.copyPath")}
              onClick={() => {
                void copy(path);
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              }}
            >
              <Icon name={copied ? "check" : "copy"} className="glyph size-3.75" />
            </button>
            <button
              className="btn-icon"
              title={t("note.open")}
              aria-label={t("note.open")}
              onClick={() => openNote(path)}
            >
              <Icon name="out" className="glyph size-3.75" />
            </button>
            <span className="w-px h-4 bg-separator-strong mx-1" />
          </>
        ) : null}
        <button className="btn-icon" title={t("pr.close")} aria-label={t("nav.close")} onClick={closeDrawer}>
          <Icon name="close" className="glyph size-3.75" />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {err ? (
          <div className="err-box m-4.5">{err}</div>
        ) : !note ? (
          <div className="p-4.5">
            <Note>{t("pr.loading")}</Note>
          </div>
        ) : (
          <article className="max-w-[520px] pt-7 px-8 pb-10 flex flex-col gap-5">
            <header className="flex flex-col gap-2.5">
              <h1 className="text-xl leading-[1.3] font-semibold tracking-[-0.01em] text-pretty">{title}</h1>
              {prop("description") ? (
                <Markdown
                  className="md-note leading-[1.55] text-secondary text-pretty [&_p]:my-0 [&_code]:bg-transparent [&_code]:p-0"
                  text={prop("description")}
                />
              ) : null}
              {properties.length ? (
                <button
                  className="self-start flex items-center gap-2 h-6.5 -ml-2 px-2 rounded-[7px] text-xs text-tertiary hover:bg-fill hover:text-secondary"
                  aria-expanded={open}
                  onClick={() => setOpen(!open)}
                >
                  {(summary.length ? summary : [t("note.properties")]).map((part, i) => (
                    <span key={i} className="contents">
                      {i ? <span>·</span> : null}
                      <span>{part}</span>
                    </span>
                  ))}
                  <Icon name="chevron" className={`glyph size-3 ${open ? "rotate-180" : ""}`} />
                </button>
              ) : null}
              {open ? (
                // the frontmatter as Obsidian shows it: key and value per row, its [[links]] clickable
                <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1.5 pt-2.5 pb-0.5 border-t border-separator text-xs leading-normal">
                  {properties
                    .filter(([key]) => !LEAD.includes(key))
                    .map(([key, values]) => (
                      <div key={key} className="contents">
                        <dt className="text-tertiary">{key}</dt>
                        <dd className="text-secondary wrap-anywhere">
                          {values.map((value, i) => (
                            <span key={i}>
                              {i ? ", " : null}
                              <PropertyValue value={value} />
                            </span>
                          ))}
                        </dd>
                      </div>
                    ))}
                  <dt className="text-tertiary">path</dt>
                  <dd className="font-mono text-[11.5px] text-secondary wrap-anywhere">{path}</dd>
                </dl>
              ) : null}
            </header>

            <div className="h-px bg-separator" />

            {/* inline code without its box: a document, not a chat answer */}
            <Markdown
              className="md-note leading-[1.65] text-pretty [&_:not(pre)>code]:bg-transparent [&_:not(pre)>code]:p-0 [&_:not(pre)>code]:text-label"
              text={body}
            />

            {links.length ? (
              <nav className="flex flex-col gap-0.5 mt-2">
                <div className="text-xs font-semibold text-secondary mb-1.5">{t("note.linked")}</div>
                {links.map(link => (
                  <a
                    key={link.target}
                    href="#"
                    data-note={link.target}
                    className="flex items-center gap-2.5 h-9 -mx-2 px-2 rounded-[7px] text-label hover:bg-fill"
                  >
                    <Icon name="link" className="glyph size-3.5 text-tertiary flex-none" />
                    <span className="flex-1 min-w-0 truncate text-[13px]">{link.label}</span>
                    <span className="text-xs text-tertiary">{link.folder}</span>
                  </a>
                ))}
              </nav>
            ) : null}
          </article>
        )}
      </div>
    </div>
  );
}

/** A property's [[link]] as its label, the rest as written. */
const linkLabel = (value: string) =>
  value.replace(/\[\[([^\]\n]+)\]\]/g, (_, inner: string) => inner.split("|").pop()!.trim());

/** A property's value: a [[link]] in it opens the note when it exists, the rest as written. */
function PropertyValue({ value }: { value: string }) {
  return value.split(/(\[\[[^\]\n]+\]\])/).map((part, i) => {
    const link = /^\[\[([^\]\n]+)\]\]$/.exec(part);
    if (!link) return part;
    const target = noteOf(link[1]);
    return noteKnown(target) ? (
      <a key={i} className="vlink text-accent cursor-pointer" href="#" data-note={target}>
        {linkLabel(part)}
      </a>
    ) : (
      linkLabel(part)
    );
  });
}
