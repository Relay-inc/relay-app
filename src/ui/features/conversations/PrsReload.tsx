import { usePullRequestsStore } from "../../../application/pull-requests/store";
import { loadPrs } from "../../../application/pull-requests/prs";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";

const minutesSince = (at: number) => Math.floor((Date.now() - at) / 6e4);

/** The pull requests view's title bar: when the list arrived, and a reload. */
export function PrsReload() {
  const { t } = useT();
  const at = usePullRequestsStore(s => s.at);
  const busy = usePullRequestsStore(s => s.busy);
  // redrawn when the list or its state changes, as the Lit bar was
  const minutes = at ? minutesSince(at) : 0;
  const updated = !at
    ? ""
    : minutes < 1
      ? t("pr.updatedNow")
      : minutes < 60
        ? t("pr.updatedMin", { n: minutes })
        : t("pr.updatedHour", { n: Math.floor(minutes / 60) });
  return (
    <>
      <span className="text-xs text-tertiary mr-1">{updated}</span>
      <button
        className="btn-icon disabled:opacity-40 cursor-pointer"
        disabled={busy}
        title={t("pr.reload")}
        aria-label={t("pr.reload")}
        onClick={loadPrs}
      >
        <Icon name="refresh" className={`glyph size-4 ${busy ? "animate-spin" : ""}`} />
      </button>
    </>
  );
}
