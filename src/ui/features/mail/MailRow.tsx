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
  "font-semibold before:inline-block before:w-2 before:h-2 before:rounded-full before:bg-accent before:mr-2";

/** One mail in the inbox: unread in bold with a dot like Mail.app; the date, and on hover the read/unread button in its
 *  place. `project` is the display label of the mail's project, "" when it has none. */
export function MailRow({
  mail,
  sender,
  project,
  selected,
  onOpen,
  onFlip,
}: {
  mail: Mail;
  sender: string;
  project: string;
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
      className={`group flex gap-4 items-center py-2.5 -mx-2.5 px-2.5 rounded-lg border-b border-separator text-inherit cursor-default transition-colors duration-150 ease-out ${selected ? "bg-accent/15" : "hover:bg-fill"}`}
      onClick={onOpen}
    >
      <div className="min-w-0 flex-1">
        <div className={`text-base leading-snug line-clamp-1 group-hover:text-accent ${mail.unread ? UNREAD : ""}`}>
          {/* a space between the unread dot and the subject; at the start of a line without the dot it collapses */}{" "}
          {mail.subject || t("mail.noSubject")}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-secondary mt-0.5 tabular-nums">
          <span>{sender}</span>
          {project ? <span>{project}</span> : null}
        </div>
      </div>
      <div className="grid justify-items-end">
        <span className="col-start-1 row-start-1 flex text-sm text-secondary mt-0.5 tabular-nums group-hover:invisible">
          {formatWhen(mail.date, locale)}
        </span>
        <button
          className="col-start-1 row-start-1 btn inline-grid place-items-center w-6! h-6! p-0! invisible group-hover:visible"
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
