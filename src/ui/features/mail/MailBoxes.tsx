import type { MailBox } from "../../../domain/mail/types";
import { useT } from "../../hooks/useT";

/** Inbox and Other as two tabs, each with its unread count (experimental). */
export function MailBoxes({
  box,
  unread,
  onBox,
}: {
  box: MailBox;
  unread: Record<MailBox, number>;
  onBox: (box: MailBox) => void;
}) {
  const { t } = useT();
  const tab = (id: MailBox, label: string) => {
    const active = box === id;
    return (
      <button
        className={`px-2 py-1 rounded-md text-[11px] font-semibold uppercase tracking-[0.06em] cursor-pointer ${active ? "bg-fill text-primary" : "text-tertiary hover:text-secondary"}`}
        aria-pressed={active}
        onClick={() => onBox(id)}
      >
        {label}
        {unread[id] ? (
          <>
            {" "}
            <span className="tabular-nums font-medium">{unread[id]}</span>
          </>
        ) : null}
      </button>
    );
  };
  return (
    <div className="flex items-center gap-1 px-1 pt-1 pb-2">
      {tab("inbox", t("mail.inbox"))}
      {tab("other", t("mail.other"))}
    </div>
  );
}
