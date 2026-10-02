import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";
import mark from "../../assets/relay-mark.svg";

const BTN =
  "relative flex size-7 items-center justify-center rounded-md text-secondary hover:bg-fill-2 hover:text-label transition-colors duration-150 ease-out";
const GLYPH = "glyph size-4 flex-none";
const DOT = { "": "bg-ok", soon: "bg-soon", late: "bg-late" };

/** The footer bar: the Relay mark, the usage button with its status dot, the light/dark toggle and the settings button. */
export function SidebarFooter({
  selected,
  dark,
  tip,
  level,
  onUsage,
  onTheme,
  onSettings,
}: {
  selected: boolean; // the usage view is open
  dark: boolean; // the page is dark: the toggle offers light
  tip: string; // the usage button's tooltip
  level: "" | "soon" | "late"; // "" shows no dot
  onUsage: () => void;
  onTheme: () => void;
  onSettings: () => void;
}) {
  const { t } = useT();
  const themeTip = t(dark ? "nav.themeLight" : "nav.themeDark");
  return (
    <div className="flex items-center gap-0.5 pt-2 pr-2 pb-2.5 pl-3.5 border-t border-separator">
      <img className="w-3.5 h-4 flex-none" src={mark} alt="Relay" title="Relay" />
      <span className="flex-1" />
      <button
        className={`${BTN} ${selected ? "bg-accent-soft text-accent-text!" : ""}`}
        title={tip}
        aria-label={tip}
        onClick={onUsage}
      >
        <Icon name="gauge" className={GLYPH} />
        <span
          className={`absolute bottom-1.25 right-1.25 size-1.5 rounded-full ring-[1.5px] ring-sidebar ${level ? "opacity-100" : "opacity-0"} ${DOT[level]}`}
        />
      </button>
      <button className={BTN} title={themeTip} aria-label={themeTip} onClick={onTheme}>
        <Icon name={dark ? "sun" : "moon"} className={GLYPH} />
      </button>
      <button className={BTN} title={t("nav.settingsTooltip")} aria-label={t("nav.settingsLabel")} onClick={onSettings}>
        <Icon name="gear" className={GLYPH} />
      </button>
    </div>
  );
}
