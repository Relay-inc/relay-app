import { RecordingRow } from "./RecordingRow";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

/** The footer bar: what Relay records when it does (RecordingRow), and the workspace with its menu, which also holds
 *  usage, the light/dark toggle and settings. */
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
  tip: string; // the usage item's text
  level: "" | "soon" | "late"; // "" shows no dot
  update: string; // a newer Relay version: a dot on the settings item, "" for none
  onUsage: () => void;
  onTheme: () => void;
  onSettings: () => void;
}) {
  return (
    <div className="flex flex-col border-t border-separator">
      <RecordingRow />
      <div className="flex items-center pt-2 pr-2 pb-2.5 pl-2">
        <WorkspaceSwitcher
          usageOpen={selected}
          usageTip={tip}
          level={level}
          dark={dark}
          update={update}
          onUsage={onUsage}
          onTheme={onTheme}
          onSettings={onSettings}
        />
      </div>
    </div>
  );
}
