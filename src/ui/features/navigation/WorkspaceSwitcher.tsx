import { useEffect, useRef, useState } from "react";
import {
  openFolderAsWorkspace,
  openWorkspaceSettings,
  switchWorkspace,
  workspaces,
  type Workspace,
} from "../../../application/navigation/workspaces";
import { useDerived } from "../../hooks/useDerived";
import { filesOn } from "../../../application/settings/settings";
import { useDismiss } from "../../hooks/useDismiss";
import { useT } from "../../hooks/useT";
import { useKeyLabel } from "../../hooks/useKeyLabel";
import { useSettingsStore } from "../../../application/settings/store";
import { WORKSPACE_KEYS, workspaceKeyLabel } from "../../../domain/settings/shortcuts";
import { Icon } from "../../components/Icon";
import { loadInbox, onAnyComments, openPageThread, type InboxItem } from "../../../application/navigation/pages";
import { noteName } from "../../../domain/navigation/pages";

// a workspace's square in the context tints, by its place in the list
const TINTS = ["text-ctx-a", "text-ctx-m", "text-ctx-p"];
const ACTION =
  "w-full px-2 py-1.5 rounded-md text-left text-[13px] text-label hover:bg-accent hover:text-on-accent cursor-default";
const APP_ACTION = `${ACTION} flex items-center gap-2.5`;
const GLYPH = "glyph size-4 flex-none";

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
 *  settings, then the app's own items: light/dark and settings (with a dot when there is a Relay update). An update
 *  also puts a dot on the square, so it shows with the menu closed. Usage has its own button next to it. */
export function WorkspaceSwitcher({
  dark,
  update,
  onTheme,
  onSettings,
}: {
  dark: boolean; // the page is dark: the toggle offers light
  update: string; // a newer Relay version, "" for none
  onTheme: () => void;
  onSettings: () => void;
}) {
  const { t, tn } = useT();
  const settingsKey = useKeyLabel("app.settings");
  // ⌃1 to ⌃9 as bound in Settings › Shortcuts, none where the answers on a question take the key
  const keys = useSettingsStore(s =>
    WORKSPACE_KEYS.map((_, i) => workspaceKeyLabel(s.settings, i + 1)).join("\n"),
  ).split("\n");
  const list = useDerived(() => workspaces());
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useDismiss(root, open, () => setOpen(false));
  const index = Math.max(
    0,
    list.findIndex(workspace => workspace.active),
  );
  const active = list[index];
  // a team workspace's Inbox (ticket 12): read when it is shown, when the menu opens and when a comment arrives
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [showInbox, setShowInbox] = useState(false);
  const files = useDerived(filesOn);
  // the Inbox is part of Files (experimental): without it a team workspace has none
  const team = active?.team && files ? active.folder : "";
  const readInbox = () => {
    if (team) void loadInbox(team).then(setInbox, () => setInbox([]));
  };
  useEffect(readInbox, [team, open]);
  const items = team ? inbox : [];
  useEffect(() => {
    if (!team) return;
    const stop = onAnyComments(readInbox);
    return () => void stop.then(f => f());
  }, [team]); // eslint-disable-line react-hooks/exhaustive-deps
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
        onClick={() => {
          setOpen(!open);
          setShowInbox(false);
        }}
      >
        <span className="relative flex-none">
          <Square workspace={active} index={index} size="size-7" />
          <span
            className={`absolute -top-0.5 -right-0.5 size-2 rounded-full bg-accent ring-2 ring-sidebar ${update ? "opacity-100" : "opacity-0"}`}
          />
        </span>
        <span className="min-w-0 flex-1 grid">
          <span className="truncate text-[13px] font-medium text-label">{active.name}</span>
          <span className="truncate text-[11px] text-tertiary">{tn("ws.notes", active.notes)}</span>
        </span>
        <Icon name="chevron" className="glyph size-3 flex-none stroke-2 text-tertiary rotate-180" />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute z-20 bottom-full left-0 mb-2 w-80 flex flex-col p-1.5 bg-bg border border-separator rounded-xl shadow-lg"
        >
          {showInbox ? (
            <Inbox
              items={items}
              onBack={() => setShowInbox(false)}
              onPick={i => run(() => openPageThread(i.page, i.thread.id))}
            />
          ) : null}
          <div
            className={`px-2 pt-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-tertiary ${showInbox ? "hidden" : ""}`}
          >
            {t("ws.title")}
          </div>
          {(showInbox ? [] : list).map((workspace, i) => (
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
                    // a team workspace says first how it syncs; the path, the longest, last where it may be cut
                    workspace.team ? t("ws.team") : "",
                    workspace.team ? t(workspace.live ? "ws.live" : "ws.rounds") : "",
                    tn("ws.notes", workspace.notes),
                    workspace.folder.replace(/^\/Users\/[^/]+/, "~"),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              {keys[i] ? <span className="flex-none text-xs text-tertiary tabular-nums">{keys[i]}</span> : null}
              <Icon
                name="check"
                className={`glyph size-3.5 flex-none stroke-2 text-accent-text ${workspace.active ? "" : "invisible"}`}
              />
            </button>
          ))}
          {team && !showInbox ? (
            <button className={APP_ACTION} onClick={() => setShowInbox(true)}>
              <Icon name="mail" className={GLYPH} />
              <span className="flex-1">{t("ws.inbox")}</span>
              {items.length ? (
                <span className="flex-none text-xs tabular-nums text-secondary">{items.length}</span>
              ) : null}
            </button>
          ) : null}
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
          <div className="my-1.5 mx-2 border-t border-separator" />
          <button className={APP_ACTION} onClick={() => run(onTheme)}>
            <Icon name={dark ? "sun" : "moon"} className={GLYPH} />
            <span className="flex-1">{t(dark ? "nav.themeLight" : "nav.themeDark")}</span>
          </button>
          <button className={APP_ACTION} onClick={() => run(onSettings)}>
            <Icon name="gear" className={GLYPH} />
            <span className="min-w-0 flex-1 truncate">
              {update ? t("nav.updateTooltip", { version: update }) : t("nav.settings")}
            </span>
            {update ? (
              <span className="size-1.5 flex-none rounded-full bg-accent" />
            ) : (
              <span className="flex-none text-xs opacity-60">{settingsKey}</span>
            )}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** The Inbox's list in the menu: each open thread for you with its page, quote and newest words; a click opens the page
 *  with that thread. */
function Inbox({ items, onBack, onPick }: { items: InboxItem[]; onBack: () => void; onPick: (i: InboxItem) => void }) {
  const { t } = useT();
  return (
    <div className="flex flex-col">
      <button className={`${APP_ACTION} text-secondary`} onClick={onBack}>
        <Icon name="chevron" className="glyph size-3 flex-none stroke-2 rotate-90" />
        <span className="flex-1">{t("ws.inboxBack")}</span>
      </button>
      <div className="px-2 pt-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-tertiary">
        {t("ws.inbox")}
      </div>
      {items.length ? (
        <div className="max-h-80 overflow-y-auto flex flex-col">
          {items.map(i => {
            const last = i.thread.replies[i.thread.replies.length - 1] ?? i.thread;
            return (
              <button
                key={i.thread.id}
                className="flex flex-col gap-0.5 px-2 py-1.5 rounded-lg text-left cursor-default hover:bg-fill-2"
                onClick={() => onPick(i)}
              >
                <span className="flex items-center gap-1.5 text-[13px] font-medium text-label">
                  {i.thread.mentionsMe ? <span className="size-1.5 flex-none rounded-full bg-accent" /> : null}
                  <span className="truncate">{noteName(i.page)}</span>
                </span>
                <span className="truncate text-xs text-secondary italic">“{i.thread.quote}”</span>
                <span className="truncate text-xs text-tertiary">
                  {last.by}: {last.text}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="px-2 py-1.5 text-xs text-tertiary">{t("ws.inboxEmpty")}</p>
      )}
    </div>
  );
}
