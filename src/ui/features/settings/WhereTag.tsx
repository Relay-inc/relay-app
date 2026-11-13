import { Icon } from "../../components/Icon";
import { useT } from "../../hooks/useT";

/** Where a step happens: in Relay (a click here) or on the server box (a terminal there, for whoever runs it). */
export function WhereTag({ where }: { where: "relay" | "box" }) {
  const { t } = useT();
  return (
    <span className="inline-flex h-5 flex-none items-center gap-1 rounded-[5px] border border-s-border px-1.5 text-[11px] font-normal text-s-muted">
      <Icon name={where === "relay" ? "laptop" : "term"} className="glyph size-3 flex-none stroke-2" />
      {t(where === "relay" ? "srv.inRelay" : "srv.onBox")}
    </span>
  );
}
