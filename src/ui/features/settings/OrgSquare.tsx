import { orgInitials } from "../../../domain/settings/servers";
import { Icon } from "../../components/Icon";

/** An organisation's square in the trust colour: the initials of its name, a building while it has none. `big` for a
 *  page's header, small for a row in a list or a menu. */
export function OrgSquare({ name, big = false }: { name: string | undefined; big?: boolean }) {
  const initials = orgInitials(name);
  return (
    <span
      aria-hidden="true"
      className={`grid flex-none place-items-center bg-trust-org/12 font-semibold text-trust-org ${big ? "size-11 rounded-xl text-base" : "size-5 rounded-[5px] text-[10px]"}`}
    >
      {initials || <Icon name="building" className={`glyph stroke-[1.5] ${big ? "size-5.5" : "size-3.5"}`} />}
    </span>
  );
}
