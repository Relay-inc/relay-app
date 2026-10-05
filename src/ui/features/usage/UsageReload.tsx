import { useUsageStore } from "../../../application/usage/store";
import { refreshUsage } from "../../../application/usage/usage";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";

const minutesSince = (at: number) => Math.floor((Date.now() - at) / 6e4);

/** The usage view's title bar: when the tokens were read, and a refresh. */
export function UsageReload() {
  const { t } = useT();
  const at = useUsageStore(s => s.tokensAt);
  const busy = useUsageStore(s => s.reading);
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
        onClick={refreshUsage}
      >
        <Icon name="refresh" className={`glyph size-4 ${busy ? "animate-spin" : ""}`} />
      </button>
    </>
  );
}
