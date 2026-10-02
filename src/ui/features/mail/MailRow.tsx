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

/** One mail in the inbox: unread in bold with a dot like Mail.app; the date, and on hover the read/unread button in its
 *  place. `project` is the display label of the mail's project, `account` the account's address when there is more than
 *  one; "" when there is none. */
export function MailRow({
  mail,
  sender,
  project,
  account,
  selected,
  onOpen,
  onFlip,
}: {
  mail: Mail;
  sender: string;
  project: string;
  account: string;
  selected: boolean;
  onOpen: () => void;
  onFlip: () => void;
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
      className={`group flex gap-3 items-start p-2.5 rounded-[9px] text-inherit cursor-pointer transition-colors duration-150 ease-out ${selected ? "bg-accent-soft" : "hover:bg-fill"}`}
      onClick={onOpen}
    >
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
        <button
          className="col-start-1 row-start-1 btn btn-icon cursor-pointer w-6! h-6! invisible group-hover:visible"
          title={flipLabel}
          aria-label={flipLabel}
          onClick={e => {
            e.stopPropagation();
            onFlip();
          }}
        >
          <Icon name={mail.unread ? "read" : "unread"} />
        </button>
      </div>
    </div>
  );
}
