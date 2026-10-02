import { useMailStore } from "../../../application/mail/store";
import { loadMails } from "../../../application/mail/mail";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";

/** The mail view's title bar: a reload that spins while the inbox loads. */
export function MailReload() {
  const { t } = useT();
  const busy = useMailStore(s => s.busy);
  return (
    <button
      className="btn-icon disabled:opacity-40 cursor-pointer"
      disabled={busy}
      title={t("pr.reload")}
      aria-label={t("pr.reload")}
      onClick={loadMails}
    >
      <Icon name="refresh" className={`glyph size-4 ${busy ? "animate-spin" : ""}`} />
    </button>
  );
}
