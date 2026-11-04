import { useState } from "react";
import { fileName, keeps, rawText, type FilingItem, type InboxNote } from "../../../domain/inbox/rules";
import { accept, cancelEdit, editDest, saveEdit, skip, useInboxStore } from "../../../application/inbox/inbox";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";
import { DestPicker } from "./DestPicker";

const OUTLINE = "btn h-6.5 px-2.5 rounded-lg text-[13px] cursor-pointer disabled:opacity-50";
const QUIET = "h-6.5 px-2 rounded-lg text-[13px] text-secondary cursor-pointer hover:bg-fill";

/** One note of the Inbox: its file and what it says, and once Claude has proposed, the title, type, folder and links it
 *  would give it with Accept, Edit and Skip. Edit turns the folder into a path picker with Save and Cancel. */
export function InboxRow({
  note,
  item,
  skipped,
  last,
}: {
  note: InboxNote;
  item?: FilingItem;
  skipped: boolean;
  last: boolean;
}) {
  const { t } = useT();
  const busy = useInboxStore(s => s.busy);
  const edit = useInboxStore(s => s.edit);
  const [all, setAll] = useState(false);
  const editing = !!item && edit?.path === item.path;
  const quote = rawText(note.text, item ? 140 : 220);
  const shape = `${last ? "" : "border-b border-separator"} ${editing ? "bg-accent-soft" : ""}`;
  if (!item)
    return (
      <div data-inbox-note={note.path} className={`flex items-center gap-3 px-3.5 py-3 ${shape}`}>
        <div className="flex-1 min-w-0">
          <div className="font-mono text-xs text-secondary">{fileName(note.path)}</div>
          <div className="mt-1 truncate">{quote || t("notes.untitled")}</div>
        </div>
        {skipped ? <span className="flex-none text-xs text-tertiary">{t("inbox.skipped")}</span> : null}
      </div>
    );
  return (
    <div data-inbox-note={note.path} className={`relative px-3.5 py-3 ${shape}`}>
      <div className="flex items-center gap-2 text-xs text-secondary">
        <span className="font-mono">{fileName(note.path)}</span>
        <span>·</span>
        <span className="flex-1 min-w-0 truncate italic">“{quote}”</span>
      </div>
      <div className="flex items-center gap-2.5 mt-1.75">
        <Icon name="right" className="glyph size-3 flex-none text-tertiary" />
        <span className="font-semibold text-sm">{item.title}</span>
        {item.type ? (
          <span className="h-5 inline-flex items-center px-1.75 rounded-md bg-fill-2 text-xs">{item.type}</span>
        ) : null}
        <span className="flex-1" />
        {editing ? (
          <>
            <button className={OUTLINE} disabled={busy !== ""} onClick={saveEdit}>
              {t("inbox.save")}
            </button>
            <button className={QUIET} onClick={cancelEdit}>
              {t("pages.cancel")}
            </button>
          </>
        ) : (
          <>
            {keeps(item) ? null : (
              <button className={OUTLINE} disabled={busy !== ""} onClick={() => void accept([item.path])}>
                {t("inbox.accept")}
              </button>
            )}
            <button className={OUTLINE} disabled={busy !== ""} onClick={() => editDest(item.path)}>
              {t("inbox.edit")}
            </button>
            <button className={QUIET} onClick={() => skip(item.path)}>
              {t("inbox.skip")}
            </button>
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 mt-1.75 ml-5.5 text-xs">
        <span className="text-secondary">{t("inbox.to")}</span>
        {editing && edit ? (
          <DestPicker item={item} dest={edit.dest} all={all} onAll={() => setAll(true)} />
        ) : (
          <span className={keeps(item) ? "text-secondary" : "font-mono"}>
            {keeps(item) ? t("inbox.stays") : `${item.dest}/`}
          </span>
        )}
        <span className="w-2.5" />
        {item.links.map(link => (
          <span
            key={`${link.k}${link.v}`}
            className="h-5 inline-flex items-center gap-1 px-1.75 rounded-md border border-separator-strong"
          >
            <span className="text-secondary">{link.k}:</span>
            <span className="text-accent-text">{link.v}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
