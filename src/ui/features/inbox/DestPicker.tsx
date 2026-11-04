import { useRef } from "react";
import { choices, INBOX, type FilingItem } from "../../../domain/inbox/rules";
import { cancelEdit, folders, homeKey, pickDest, saveEdit, useInboxStore } from "../../../application/inbox/inbox";
import { useDismiss } from "../../hooks/useDismiss";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";

/** The destination of a proposal as a path picker (K7): a field that filters the folders of the workspace, the type's
 *  home marked, Keep in Inbox/ and Browse folders… under them. Picking a line sets the folder; Save on the row writes it. */
export function DestPicker({
  item,
  dest,
  all,
  onAll,
}: {
  item: FilingItem;
  dest: string;
  all: boolean;
  onAll: () => void;
}) {
  const { t } = useT();
  const box = useRef<HTMLDivElement>(null);
  // Save and Cancel are in the same row: a press there is theirs, not a dismissal
  useDismiss(box, true, cancelEdit, { on: "pointerdown", inside: target => !!target.closest("[data-inbox-note]") });
  // the type's home arrives after the picker opened
  const home = useInboxStore(s => s.home[homeKey(item.type)]) ?? null;
  const list = choices({
    current: item.dest,
    kind: item.type,
    home,
    folders: folders(),
    query: dest === item.dest ? "" : dest,
    all,
  });
  const shown = dest === INBOX ? "" : dest;
  const row = "flex items-center gap-2 px-2 rounded-lg text-left cursor-pointer hover:bg-fill";
  return (
    <div ref={box} className="relative">
      <span className="h-6.5 inline-flex items-center px-2 rounded-lg border border-accent bg-bg ring-3 ring-focus">
        <input
          autoFocus
          role="combobox"
          aria-expanded
          aria-controls="inbox-folders"
          aria-label={t("inbox.dest")}
          className="w-80 bg-transparent outline-none font-mono text-xs"
          value={shown}
          placeholder={t("inbox.keep")}
          onChange={e => pickDest(e.target.value.trim() || INBOX)}
          onKeyDown={e => {
            if (e.key === "Enter") saveEdit();
          }}
        />
      </span>
      <div
        id="inbox-folders"
        role="listbox"
        aria-label={t("inbox.choose")}
        className="absolute left-0 top-8 z-10 w-95 p-1.5 rounded-xl bg-bg shadow-lg border border-separator text-xs"
      >
        {list.map(choice => (
          <button
            key={choice.path}
            role="option"
            aria-selected={choice.path === dest}
            className={`${row} h-7.5 w-full ${choice.path === dest ? "bg-accent-soft" : ""}`}
            onClick={() => pickDest(choice.path)}
          >
            <Icon name="folder" className="glyph size-3.5 flex-none text-secondary" />
            <span className="flex-1 min-w-0 truncate font-mono">{choice.path}/</span>
            {choice.home ? (
              <span className="flex-none text-accent-text">{t("inbox.homeFor", { type: choice.home })}</span>
            ) : null}
          </button>
        ))}
        <div className="h-px bg-separator my-1" />
        <button
          role="option"
          aria-selected={dest === INBOX}
          className={`${row} h-7 w-full text-secondary ${dest === INBOX ? "bg-accent-soft" : ""}`}
          onClick={() => pickDest(INBOX)}
        >
          {t("inbox.keep")}
        </button>
        {all ? null : (
          <button role="option" aria-selected={false} className={`${row} h-7 w-full text-secondary`} onClick={onAll}>
            {t("inbox.browse")}
          </button>
        )}
      </div>
    </div>
  );
}
