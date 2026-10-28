import { useRef, useState } from "react";
import {
  openFolderAsWorkspace,
  openWorkspaceSettings,
  switchWorkspace,
  workspaces,
  type Workspace,
} from "../../../application/navigation/workspaces";
import { useDerived } from "../../hooks/useDerived";
import { useDismiss } from "../../hooks/useDismiss";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";

// a workspace's square in the context tints, by its place in the list
const TINTS = ["text-ctx-a", "text-ctx-m", "text-ctx-p"];
const ACTION =
  "w-full px-2 py-1.5 rounded-md text-left text-[13px] text-label hover:bg-accent hover:text-on-accent cursor-default";

function Square({ workspace, index, size }: { workspace: Workspace; index: number; size: string }) {
  return (
    <span
      className={`${size} flex-none grid place-items-center rounded-md bg-fill-2 text-xs font-semibold ${TINTS[index % TINTS.length]}`}
    >
      {workspace.initials}
    </span>
  );
}

/** The footer's workspace: its square, name and note count; a click opens the menu above it with every workspace
 *  (⌃1 to ⌃9, a tick on the one shown), Open a folder as workspace…, New workspace from template… and Workspace
 *  settings. */
export function WorkspaceSwitcher() {
  const { t, tn } = useT();
  const list = useDerived(() => workspaces());
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useDismiss(root, open, () => setOpen(false));
  const index = Math.max(
    0,
    list.findIndex(workspace => workspace.active),
  );
  const active = list[index];
  if (!active) return <span className="flex-1" />;
  const run = (action: () => unknown) => {
    setOpen(false);
    void action();
  };
  return (
    <div ref={root} className="relative flex-1 min-w-0">
      <button
        className={`w-full flex items-center gap-2 p-1 rounded-md text-left cursor-default hover:bg-fill-2 ${open ? "bg-fill-2" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t("ws.switch")}
        aria-label={`${t("ws.switch")}: ${active.name}`}
        onClick={() => setOpen(!open)}
      >
        <Square workspace={active} index={index} size="size-7" />
        <span className="min-w-0 flex-1 grid">
          <span className="truncate text-[13px] font-medium text-label">{active.name}</span>
          <span className="truncate text-[11px] text-tertiary">{tn("ws.notes", active.notes)}</span>
        </span>
        <Icon name="chevron" className="glyph size-3 flex-none stroke-2 text-tertiary rotate-180" />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute z-20 bottom-full left-0 mb-2 w-80 grid p-1.5 bg-bg border border-separator rounded-xl shadow-lg"
        >
          <div className="px-2 pt-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-tertiary">
            {t("ws.title")}
          </div>
          {list.map((workspace, i) => (
            <button
              key={workspace.folder}
              role="menuitemradio"
              aria-checked={workspace.active}
              className={`flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left cursor-default hover:bg-fill-2 ${workspace.active ? "bg-fill-2" : ""}`}
              title={workspace.folder}
              onClick={() => run(() => switchWorkspace(workspace.folder))}
            >
              <Square workspace={workspace} index={i} size="size-7" />
              <span className="min-w-0 flex-1 grid">
                <span className="truncate text-[13px] font-medium text-label">{workspace.name}</span>
                <span className="truncate text-[11px] text-tertiary">
                  {[
                    workspace.folder.replace(/^\/Users\/[^/]+/, "~"),
                    tn("ws.notes", workspace.notes),
                    workspace.team ? t("ws.team") : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              {i < 9 ? <span className="flex-none text-xs text-tertiary tabular-nums">⌃{i + 1}</span> : null}
              <Icon
                name="check"
                className={`glyph size-3.5 flex-none stroke-2 text-accent-text ${workspace.active ? "" : "invisible"}`}
              />
            </button>
          ))}
          <div className="my-1.5 mx-2 border-t border-separator" />
          <button className={ACTION} onClick={() => run(openFolderAsWorkspace)}>
            {t("ws.openFolder")}
          </button>
          <button className={ACTION} onClick={() => run(() => openWorkspaceSettings("machines"))}>
            {t("ws.fromTemplate")}
          </button>
          <button
            className={`${ACTION} text-secondary`}
            onClick={() => run(() => openWorkspaceSettings(active.team ? "machines" : "general"))}
          >
            {t("ws.settings")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
