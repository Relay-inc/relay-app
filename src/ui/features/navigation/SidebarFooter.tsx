import { RecordingRow } from "./RecordingRow";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { UsagePopover } from "../usage/UsagePopover";

/** The footer bar: what Relay records when it does (RecordingRow), the workspace with its menu, which also holds the
 *  light/dark toggle and settings, and next to it the usage button with its summary. */
export function SidebarFooter({
  selected,
  dark,
  tip,
  level,
  onUsage,
  onTheme,
  onSettings,
  update,
}: {
  selected: boolean; // the usage view is open
  dark: boolean; // the page is dark: the toggle offers light
  tip: string; // the usage button's tooltip
  level: "" | "soon" | "late"; // "" shows no dot
  update: string; // a newer Relay version: a dot on the settings item, "" for none
  onUsage: () => void;
  onTheme: () => void;
  onSettings: () => void;
}) {
  return (
    <div className="flex flex-col border-t border-separator">
      <RecordingRow />
      <div className="relative flex items-center gap-1 pt-2 pr-2 pb-2.5 pl-2">
        <WorkspaceSwitcher dark={dark} update={update} onTheme={onTheme} onSettings={onSettings} />
        <UsagePopover selected={selected} tip={tip} level={level} onDetails={onUsage} />
      </div>
    </div>
  );
}
