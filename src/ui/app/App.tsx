import { useEffect } from "react";
import { urlOk } from "../../shared/markdown";
import { isView } from "../../domain/navigation/views";
import { noteKey } from "../../domain/navigation/keys";
import { useNavigationStore } from "../../application/navigation/store";
import { useConversationsStore } from "../../application/conversations/store";
import { useWorkspaceStore } from "../../application/workspace/store";
import { escStop, ctrlC } from "../../application/conversations/actions";
import { setPanelHidden, toggleQuickAsk, zoom, openExternal } from "../../application/navigation/navigation";
import { closeDetail, closeTicket, openDetail } from "../../application/navigation/panel";
import { request } from "../../application/navigation/requests";
import { useT } from "../hooks/useT";
import { Html } from "../components/Html";
import { copyText } from "../components/copy";
import { hasFiles } from "../components/image-files";
import { NavigationView } from "../features/navigation/NavigationView";
import { ConversationsView } from "../features/conversations/ConversationsView";
import { PanelView } from "../features/navigation/PanelView";
import { QuickAskView } from "../features/navigation/QuickAskView";
import { WorkspaceView } from "../features/workspace/WorkspaceView";

const isQuickAskKey = (e: KeyboardEvent) => e.metaKey && !e.altKey && !e.shiftKey && !e.ctrlKey && e.code === "KeyK";
const isFoldPanelKey = (e: KeyboardEvent) => e.metaKey && e.altKey && e.code === "KeyI";
const isCtrlCKey = (e: KeyboardEvent) => e.ctrlKey && !e.metaKey && !e.altKey && e.code === "KeyC";
/** Whether an event started in a text field, wherever it sits. */
const inField = (e: Event, sel = "input, textarea, select, [contenteditable]") =>
  e.composedPath().some(node => node instanceof HTMLElement && node.matches(sel));
const closest = <T extends HTMLElement>(e: Event, match: (node: HTMLElement) => boolean) =>
  e.composedPath().find((node): node is T => node instanceof HTMLElement && match(node));

// ---------- the shortcuts that work anywhere in the main window, registered once
// Esc closes the image, then the ticket window, then the right panel, then stops the running turn
function onEscape(e: KeyboardEvent) {
  const { zoom: zoomed, panel, projectPanel, quickAsk, selected } = useNavigationStore.getState();
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
  if (panel.open && !projectPanel && !inField(e)) {
    e.preventDefault();
    closeDetail();
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
function onKey(e: KeyboardEvent) {
  if (isQuickAskKey(e)) {
    // Cmd-K: a question that starts a general conversation in the background
    e.preventDefault();
    toggleQuickAsk();
  } else if (isFoldPanelKey(e)) {
    // Cmd-Alt-I folds the right panel
    e.preventDefault();
    setPanelHidden(!useNavigationStore.getState().panelHidden);
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
  // a vault note named in markdown opens in the right panel (shared/markdown.ts)
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
// no stray drop outside the composer opens the file in the webview
function noDrop(e: DragEvent) {
  if (hasFiles(e)) e.preventDefault();
}

/** The main window: sidebar, the open conversation or view, the right panel, and the overlays. */
export function App() {
  const { th } = useT();
  const panelHidden = useNavigationStore(s => s.panelHidden);
  const wide = useNavigationStore(s => !!s.panel.open);
  const quickAsk = useNavigationStore(s => s.quickAsk);
  const quickText = useNavigationStore(s => s.quickText);
  const zoomed = useNavigationStore(s => s.zoom);
  const snapErr = useWorkspaceStore(s => s.snapErr);

  useEffect(() => {
    window.addEventListener("keydown", onKey);
    document.addEventListener("click", onLink);
    window.addEventListener("dragover", noDrop);
    window.addEventListener("drop", noDrop);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onLink);
      window.removeEventListener("dragover", noDrop);
      window.removeEventListener("drop", noDrop);
    };
  }, []);

  const panelHiddenClasses = panelHidden ? "opacity-0 border-l-transparent pointer-events-none" : "";
  return (
    <div className="relay-app" data-noinsp={panelHidden || undefined} data-wide={wide || undefined}>
      {snapErr ? (
        <Html
          as="div"
          className="fixed top-0 left-1/2 -translate-x-1/2 z-40 max-w-7/10 px-3 py-1.5 rounded-b-lg bg-bg border border-separator text-late text-xs"
          html={th("vault.snapErr", { e: snapErr })}
        />
      ) : null}
      <NavigationView className="min-h-0 min-w-0 border-r border-separator" />
      <ConversationsView className="min-h-0 min-w-0" />
      <PanelView
        className={`min-h-0 min-w-0 overflow-hidden transition duration-200 ease-out max-lg:hidden ${panelHiddenClasses}`}
      />
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
