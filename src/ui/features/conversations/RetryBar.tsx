import { useConversationsStore } from "../../../application/conversations/store";
import { useNavigationStore } from "../../../application/navigation/store";
import { cancelRetry } from "../../../application/conversations/retry";
import { dateFormat } from "../../../shared/format";
import { useT } from "../../hooks/useT";
import { strip } from "./layout";

/** Under the log: the open conversation was refused for its provider's limit and goes again on its own (retry.rs). */
export function RetryBar({ className }: { className: string }) {
  const { t, locale } = useT();
  const selected = useNavigationStore(s => s.selected);
  const retry = useConversationsStore(s => s.retries[selected]);
  if (!retry) return null;
  const time = dateFormat(locale, { weekday: "short", hour: "2-digit", minute: "2-digit" }).format(retry.at);
  return (
    <div className={className}>
      <div className={`${strip} border border-separator bg-fill`}>
        <span>{t(retry.known ? "retry.at" : "retry.check", { time })}</span>
        <span className="flex-1"></span>
        <button className="btn" onClick={() => cancelRetry(selected)}>
          {t("retry.cancel")}
        </button>
      </div>
    </div>
  );
}
