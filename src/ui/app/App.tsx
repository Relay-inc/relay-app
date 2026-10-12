import { useEffect } from "react";
import { urlOk } from "../../shared/markdown";
import { isView, MAIL } from "../../domain/navigation/views";
import { noteKey } from "../../domain/navigation/keys";
import { useNavigationStore } from "../../application/navigation/store";
import { useConversationsStore } from "../../application/conversations/store";
import { useWorkspaceStore } from "../../application/workspace/store";
import { escStop, ctrlC } from "../../application/conversations/actions";
import { closeTool, toggleQuickAsk, zoom, openExternal, select } from "../../application/navigation/navigation";
import { ORCH } from "../../domain/orchestrator/rules";
import { closeDrawer, closeTicket, openDetail } from "../../application/navigation/panel";
import { request } from "../../application/navigation/requests";
import { mailExperimental } from "../../application/settings/settings";
import { useMailStore } from "../../application/mail/store";
import {
  clearMailSelection,
  mailListActive,
  mailMove,
  mailTargets,
  toggleMailSelectAll,
} from "../../application/mail/mail";
import { useT } from "../hooks/useT";
import { Html } from "../components/Html";
import { copyText } from "../components/copy";
import { NavigationView } from "../features/navigation/NavigationView";
import { ConversationsView } from "../features/conversations/ConversationsView";
import { DrawerView } from "../features/drawer/DrawerView";
import { QuickAskView } from "../features/navigation/QuickAskView";
import { WorkspaceView } from "../features/workspace/WorkspaceView";
import { useChangesStore } from "../../application/changes/store";
import { openFile } from "../../application/changes/changes";
import { ColumnResize } from "../features/navigation/ColumnResize";

const isQuickAskKey = (e: KeyboardEvent) => e.metaKey && !e.altKey && !e.shiftKey && !e.ctrlKey && e.code === "KeyK";
const isCtrlCKey = (e: KeyboardEvent) => e.ctrlKey && !e.metaKey && !e.altKey && e.code === "KeyC";
/** Whether an event started in a text field, wherever it sits. */
const inField = (e: Event, sel = "input, textarea, select, [contenteditable]") =>
  e.composedPath().some(node => node instanceof HTMLElement && node.matches(sel));
const closest = <T extends HTMLElement>(e: Event, match: (node: HTMLElement) => boolean) =>
  e.composedPath().find((node): node is T => node instanceof HTMLElement && match(node));

// ---------- the shortcuts that work anywhere in the main window, registered once
// Esc closes the image, then the ticket window or a changed file's window, then the right drawer, then a project's board or PRs, then stops the
// running turn
function onEscape(e: KeyboardEvent) {
  const { zoom: zoomed, panel, drawer, tool, projectPanel, quickAsk, selected } = useNavigationStore.getState();
  if (zoomed) {
    e.preventDefault();
    zoom("");
    return;
  }
  if (panel.modal) {
    e.preventDefault();
    closeTicket();
    return;
  }
  if (useChangesStore.getState().open) {
    e.preventDefault();
    openFile("", "");
    return;
  }
  // Esc in a terminal or a note is theirs (vim, a shell prompt): it neither closes the drawer nor stops the turn
  if (inField(e) && e.composedPath().some(node => node instanceof HTMLElement && node.matches(".relay-drawer"))) return;
  // the orchestrator's column stays: Esc on a worker's page goes back to the coordinator, on the coordinator it
  // stops a running turn
  if (drawer === "workers" && !projectPanel) {
    if (useNavigationStore.getState().orchDetail && !e.defaultPrevented) {
      e.preventDefault();
      select(ORCH);
      return;
    }
  } else if (drawer && !projectPanel && !inField(e)) {
    e.preventDefault();
    closeDrawer();
    return;
  }
  // a project's board or PRs opened from the title bar: back to the conversation (a popover that took the key first
  // has called preventDefault)
  if (tool && isView(selected) && !inField(e) && !e.defaultPrevented) {
    e.preventDefault();
    closeTool();
    return;
  }
  // the search and the title are inputs: Esc in them is theirs (the composer is a textarea, Esc there stops the turn)
  const turnRunning = useConversationsStore.getState().status[selected] === "busy" && !projectPanel && !quickAsk;
  if (turnRunning && !inField(e, "input, select")) {
    e.preventDefault();
    escStop();
  }
}
// typing anywhere in an open conversation goes to the composer, focused or not: the key itself then lands there
function typesIntoComposer(e: KeyboardEvent) {
  const { selected, projectPanel, quickAsk } = useNavigationStore.getState();
  const isCharacter = e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.isComposing;
  return isCharacter && !isView(selected) && !projectPanel && !quickAsk && !inField(e);
}
// the Mail view, experimental, as in Gmail and Keel: E archives, # or Delete deletes, Cmd-A ticks all, Esc unticks
// before the app's Esc. Whether it handled the key.
function onMailKey(e: KeyboardEvent) {
  const { selected, zoom: zoomed, panel } = useNavigationStore.getState();
  // an image or the ticket window over the view takes the keys (Esc closes it), not the mail behind it
  if (selected !== MAIL || zoomed || panel.modal || !mailExperimental() || inField(e) || e.isComposing) return false;
  const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key; // Caps Lock gives "E"
  if (plain && (key === "e" || key === "#" || key === "Delete" || key === "Backspace")) {
    // a held key would walk down the list, one mail per repeat
    if (e.repeat) {
      e.preventDefault();
      return true;
    }
    const keys = mailTargets();
    if (!keys.length) return false;
    e.preventDefault();
    mailMove(keys, key !== "e");
    return true;
  }
  if (e.metaKey && key === "a" && mailListActive()) {
    e.preventDefault();
    toggleMailSelectAll();
    return true;
  }
  if (e.key === "Escape" && useMailStore.getState().selected.size) {
    clearMailSelection();
    return true;
  }
  return false;
}
function onKey(e: KeyboardEvent) {
  if (onMailKey(e)) return;
  if (isQuickAskKey(e)) {
    // Cmd-K: a question that starts a general conversation in the background
    e.preventDefault();
    toggleQuickAsk();
  } else if (isCtrlCKey(e)) {
    // Ctrl-C like in the terminal: stops a running turn, otherwise clears what is typed
    e.preventDefault();
    ctrlC();
  } else if (e.key === "Escape") {
    onEscape(e);
  } else if (typesIntoComposer(e)) {
    request("focus-composer");
  }
}
// links in a conversation, a PR or a mail open in the default browser or mail app, a webview window cannot open them itself
function onLink(e: MouseEvent) {
  // a component that handled the click itself (a picture that opens in the viewer window)
  if (e.defaultPrevented) return;
  // a vault note named in markdown opens in the right drawer (shared/markdown.ts)
  const noteLink = closest(e, node => !!node.dataset.note);
  if (noteLink) {
    e.preventDefault();
    openDetail(noteKey(noteLink.dataset.note!));
    return;
  }
  // a code block's copy button (shared/markdown.ts)
  const copyButton = closest(e, node => node.hasAttribute("data-copy"));
  if (copyButton) {
    copyText(copyButton.closest(".codeblock")?.querySelector("pre")?.innerText ?? "", copyButton);
    return;
  }
  // the window itself never navigates: a web or mail link opens outside, any other href (relative, data:) does nothing
  const anchor = closest<HTMLAnchorElement>(e, node => node instanceof HTMLAnchorElement && !!node.href);
  if (!anchor) return;
  e.preventDefault();
  if (urlOk(anchor.href)) openExternal(anchor.href);
}

/** The main window: sidebar, the open conversation or view, the right drawer, and the overlays. */
export function App() {
  const { th } = useT();
  const drawer = useNavigationStore(s => s.drawer);
  const quickAsk = useNavigationStore(s => s.quickAsk);
  const quickText = useNavigationStore(s => s.quickText);
  const zoomed = useNavigationStore(s => s.zoom);
  const snapErr = useWorkspaceStore(s => s.snapErr);

  useEffect(() => {
    window.addEventListener("keydown", onKey);
    document.addEventListener("click", onLink);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onLink);
    };
  }, []);

  return (
    <div className="relay-app" data-drawer={drawer || undefined}>
      {snapErr ? (
        <Html
          as="div"
          className="fixed top-0 left-1/2 -translate-x-1/2 z-40 max-w-7/10 px-3 py-1.5 rounded-b-lg bg-bg border border-separator text-late text-xs"
          html={th("vault.snapErr", { e: snapErr })}
        />
      ) : null}
      <NavigationView className="min-h-0 min-w-0 border-r border-separator" />
      <ColumnResize column="sidebar" />
      <ConversationsView className="min-h-0 min-w-0" />
      {drawer ? <DrawerView className="min-h-0 min-w-0 overflow-hidden" drawer={drawer} /> : null}
      {drawer ? <ColumnResize column="drawer" /> : null}
      {quickAsk ? <QuickAskView key={quickText} /> : null}
      {zoomed ? (
        <div
          className="fixed inset-0 z-30 grid place-items-center p-10 bg-black/55 cursor-zoom-out"
          onClick={() => zoom("")}
        >
          <img className="max-w-full max-h-full rounded-lg shadow-2xl bg-bg" alt="" src={zoomed} />
        </div>
      ) : null}
      <WorkspaceView />
    </div>
  );
}
