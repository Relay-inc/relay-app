import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";

const BTN = "relative flex size-7 items-center justify-center rounded-md transition-colors duration-150 ease-out";
const GLYPH = "glyph size-4 flex-none";
const DOT = { "": "bg-secondary", soon: "bg-soon", late: "bg-late" };

/** The footer bar: the usage button with its warning dot, and the settings button. */
export function SidebarFooter({
  selected,
  tip,
  level,
  onUsage,
  onSettings,
}: {
  selected: boolean; // the usage view is open
  tip: string; // the usage button's tooltip
  level: "" | "soon" | "late"; // "" shows no dot
  onUsage: () => void;
  onSettings: () => void;
}) {
  const { t } = useT();
  return (
    <div className="flex justify-center gap-1.5 px-2.5 pt-1.5 pb-2.5 border-t border-separator">
      <button
        className={`${BTN} ${selected ? "bg-accent text-on-accent" : "text-secondary hover:bg-fill hover:text-label"}`}
        title={tip}
        aria-label={tip}
        onClick={onUsage}
      >
        <Icon name="gauge" className={GLYPH} />
        <span
          className={`absolute bottom-0.5 right-0.5 size-2 rounded-full ${level ? "opacity-100" : "opacity-0"} ${DOT[level]}`}
        />
      </button>
      <button
        className={`${BTN} text-secondary hover:bg-fill hover:text-label`}
        title={t("nav.settingsTooltip")}
        aria-label={t("nav.settingsLabel")}
        onClick={onSettings}
      >
        <Icon name="gear" className={GLYPH} />
      </button>
    </div>
  );
}
