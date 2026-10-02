import {
  allMailsSelected,
  clearMailSelection,
  mailMove,
  mailSeenSelected,
  mailTargets,
  toggleMailSelectAll,
} from "../../../application/mail/mail";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";

const button = (name: string, label: string, onClick: () => void) => (
  <button className="btn btn-icon w-7! h-7!" title={label} aria-label={label} onClick={onClick}>
    <Icon name={name} />
  </button>
);

/** In place of the tabs while mails are ticked: all/none, the count and what to do with them (experimental). */
export function MailBulkBar({ count }: { count: number }) {
  const { t } = useT();
  const all = useDerived(allMailsSelected);
  return (
    <div className="flex items-center gap-1.5 px-2 pt-1 pb-2">
      <input
        type="checkbox"
        className="cursor-pointer"
        aria-label={t("mail.selectAll")}
        checked={all}
        readOnly
        ref={el => {
          if (el) el.indeterminate = !all;
        }}
        onClick={toggleMailSelectAll}
      />
      <span className="text-xs text-secondary tabular-nums flex-1">{t("mail.selected", { n: count })}</span>
      {button("archive", `${t("mail.archive")} (E)`, () => mailMove(mailTargets(), false))}
      {button("trash", `${t("mail.trash")} (#)`, () => mailMove(mailTargets(), true))}
      {button("read", t("mail.markRead"), () => mailSeenSelected(true))}
      {button("unread", t("mail.markUnread"), () => mailSeenSelected(false))}
      {button("close", `${t("mail.clearSelection")} (Esc)`, clearMailSelection)}
    </div>
  );
}
