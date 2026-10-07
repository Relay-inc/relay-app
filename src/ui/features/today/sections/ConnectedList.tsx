import { useT } from "../../../hooks/useT";
import { Icon } from "../../../components/Icon";
import type { Connected } from "./types";

export function ConnectedList({ items }: { items: Connected[] }) {
  const { t } = useT();
  if (!items.length) return <div className="text-[13px] text-secondary">{t("today.nothingConnected")}</div>;
  return (
    <div className="flex flex-col gap-0.5">
      {items.map(item => (
        <button
          key={item.id}
          onClick={item.go}
          className="flex items-start gap-2 px-2 py-1.5 -mx-2 rounded-lg text-left cursor-pointer hover:bg-fill-2"
        >
          <Icon name={item.icon} className="glyph size-3.5 mt-0.5 flex-none text-secondary" />
          <span className="flex-1 min-w-0 flex flex-col leading-[1.35]">
            <span className="text-[13px] truncate">{item.title}</span>
            <span className="text-[11px] text-tertiary truncate">{item.meta}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
