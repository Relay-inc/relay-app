import type { Mail } from "../../../domain/mail/types";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";
import { dateFormat, dayMonth } from "../../../shared/format";

// today a time, otherwise the day
function formatWhen(iso: string, locale: string) {
  const date = new Date(iso);
  if (date.toDateString() === new Date().toDateString())
    return dateFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(date);
  return dayMonth(iso, locale);
}

const UNREAD =
  "font-semibold before:inline-block before:size-1.75 before:rounded-full before:bg-accent before:mr-1.5 before:align-middle";

const hoverButton = (name: string, label: string, onClick: () => void) => (
  <button
    className="btn btn-icon cursor-pointer w-6! h-6!"
    title={label}
    aria-label={label}
    onClick={e => {
      e.stopPropagation();
      onClick();
    }}
  >
    <Icon name={name} />
  </button>
);

/** One mail in the inbox: unread in bold with a dot like Mail.app; the date, and on hover the read/unread button in its
 *  place. `project` is the display label of the mail's project, `account` the account's address when there is more than
 *  one; "" when there is none. `selectable` (experimental): a checkbox in front, Cmd- or Shift-click ticks instead of
 *  opening, and archive/delete on hover. */
export function MailRow({
  mail,
  sender,
  project,
  account,
  selected,
  selectable = false,
  checked = false,
  onOpen,
  onFlip,
  onSelect,
  onArchive,
  onTrash,
}: {
  mail: Mail;
  sender: string;
  project: string;
  account: string;
  selected: boolean;
  selectable?: boolean;
  checked?: boolean;
  onOpen: () => void;
  onFlip: () => void;
  onSelect?: (range: boolean) => void;
  onArchive?: () => void;
  onTrash?: () => void;
}) {
  const { t, locale } = useT();
  const flipLabel = mail.unread ? t("mail.markRead") : t("mail.markUnread");
  // a div with a button's role, not a button: the read/unread button sits inside it
  return (
    <div
      role="button"
      tabIndex={0}
      onKeyDown={e => {
        if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
        e.preventDefault();
        onOpen();
      }}
      className={`group flex gap-3 items-start p-2.5 rounded-[9px] text-inherit cursor-pointer transition-colors duration-150 ease-out ${selected || checked ? "bg-accent-soft" : "hover:bg-fill"}`}
      onClick={e => {
        if (selectable && (e.metaKey || e.shiftKey)) onSelect?.(e.shiftKey);
        else onOpen();
      }}
    >
      {selectable ? (
        // the list decides, the box follows its checked prop
        <input
          type="checkbox"
          className="mt-0.5 flex-none cursor-pointer"
          aria-label={t("mail.select")}
          checked={checked}
          readOnly
          onClick={e => {
            e.stopPropagation();
            onSelect?.(e.shiftKey);
          }}
        />
      ) : null}
      <div className="min-w-0 flex-1">
        <div className={`text-[13px] leading-snug line-clamp-1 ${mail.unread ? UNREAD : "font-medium"}`}>
          {/* a space between the unread dot and the subject; at the start of a line without the dot it collapses */}{" "}
          {mail.subject || t("mail.noSubject")}
        </div>
        <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-secondary mt-1 tabular-nums">
          <span>{sender}</span>
          {account ? <span>{account}</span> : null}
          {project ? <span>{project}</span> : null}
        </div>
      </div>
      <div className="grid justify-items-end">
        <span className="col-start-1 row-start-1 flex text-xs text-secondary tabular-nums group-hover:invisible">
          {formatWhen(mail.date, locale)}
        </span>
        <span className="col-start-1 row-start-1 flex invisible group-hover:visible">
          {selectable ? (
            <>
              {hoverButton("archive", t("mail.archive"), () => onArchive?.())}
              {hoverButton("trash", t("mail.trash"), () => onTrash?.())}
            </>
          ) : null}
          {hoverButton(mail.unread ? "read" : "unread", flipLabel, onFlip)}
        </span>
      </div>
    </div>
  );
}
