import { Icon } from "../../components/Icon";
import { useT } from "../../hooks/useT";

/** Who can read a place: `org` the organisation (its name) and whoever runs its server, `e2e` only the devices and
 *  people added. Ochre and green mean only that. */
export function TrustBadge({ kind, name = "" }: { kind: "org" | "e2e"; name?: string }) {
  const { t } = useT();
  return (
    <span
      className={`inline-flex h-5 flex-none items-center gap-1 rounded-[5px] px-1.5 text-[11px] font-medium whitespace-nowrap ${kind === "org" ? "bg-trust-org/12 text-trust-org" : "bg-trust-e2e/12 text-trust-e2e"}`}
    >
      <Icon name={kind === "org" ? "eye" : "lock"} className="glyph size-3 flex-none stroke-2" />
      {kind === "org" ? t("srv.canRead", { name }) : t("srv.encrypted")}
    </span>
  );
}
