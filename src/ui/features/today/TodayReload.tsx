import { useTodayStore } from "../../../application/today/store";
import { refreshToday } from "../../../application/today/today";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";

const minutesSince = (at: number) => Math.floor((Date.now() - at) / 6e4);

/** Today's title bar: when it last read its sources, and a refresh of all of them. */
export function TodayReload() {
  const { t } = useT();
  const at = useTodayStore(s => s.at);
  const busy = useTodayStore(s => s.reloading);
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
        onClick={refreshToday}
      >
        <Icon name="refresh" className={`glyph size-4 ${busy ? "animate-spin" : ""}`} />
      </button>
    </>
  );
}
