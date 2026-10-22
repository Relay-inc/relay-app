import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Accent, Theme } from "../domain/settings/types";

// The window around the page: its colour scheme, title, focus, and the page's language.

/** The colour scheme for this window: the native window follows it (the sidebar material, the title bar), and so does
 * the css through data-theme on the page. System leaves both to macOS. The accent is data-accent on the page.
 * A change after the first one goes through a view transition, so everything shows in one frame. WebKit draws text
 * differently in light and dark and repaints it only once the appearance reaches the page, so the web view gets it
 * first (webview_theme) and the new frame waits for it. The window, and its sidebar material, follows when that frame
 * shows. Resolves when the switch is over: save after it, a save blocks the main thread the window draws on. */
let applied = false;
export function applyTheme(theme: Theme = "system", accent: Accent = "relay"): Promise<void> {
  const root = document.documentElement;
  const apply = () => {
    if (theme === "system") delete root.dataset.theme;
    else root.dataset.theme = theme;
    root.dataset.accent = accent;
  };
  const native = () =>
    getCurrentWindow()
      .setTheme(theme === "system" ? null : theme)
      .catch(() => {});
  const changed = (root.dataset.theme ?? "system") !== theme || root.dataset.accent !== accent;
  const first = !applied;
  applied = true;
  if (first || !changed || !document.startViewTransition) {
    apply();
    void native();
    return Promise.resolve();
  }
  const transition = document.startViewTransition(async () => {
    apply();
    const flipped = theme !== "system" && prefersDark() !== (theme === "dark") ? schemeChange() : undefined;
    await invoke("webview_theme", { theme: theme === "system" ? null : theme }).catch(() => {});
    await flipped;
  });
  // ready: the new frame is painted and about to show
  void transition.ready.then(native, native);
  return transition.finished.catch(() => {});
}
/** The page's prefers-color-scheme flipping, or 300 ms, whichever comes first. */
const schemeChange = () =>
  new Promise<void>(resolve => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const done = () => {
      media.removeEventListener("change", done);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, 300);
    media.addEventListener("change", done);
  });
/** Whether macOS draws dark right now (the "system" theme). */
export const prefersDark = () => matchMedia("(prefers-color-scheme: dark)").matches;
export const isFocused = () =>
  getCurrentWindow()
    .isFocused()
    .catch(() => false);
/** The native title and the document's. */
export function setTitle(title: string) {
  getCurrentWindow()
    .setTitle(title)
    .catch(() => {});
  document.title = title;
}
export const setPageLang = (lang: string) => {
  document.documentElement.lang = lang;
};
export const closeWindow = () => window.close();
/** The browser's language, when the backend cannot say. */
export const navigatorLang = () => navigator.language.slice(0, 2);

// Which window this page is: the main one, one Cmd-N opened (main-2, …), or another (settings). The active one is the
// Relay window used last (src-tauri/src/windows.rs): it alone writes the UI state, takes the menu and sends banners.
const label = (() => {
  try {
    return getCurrentWindow().label;
  } catch {
    return "main"; // no Tauri (a test)
  }
})();
export const windowLabel = label;
const relayWindow = label === "main" || label.startsWith("main-");
/** The main window: it runs what must happen once for the app (retries, board pipelines, meeting banners). */
export const isPrimary = () => label === "main";
let active = "main";
let heard = false;
const onLeave = new Set<() => void>();
void listen<string>("active-window", event => {
  const was = isActive();
  heard = true;
  active = event.payload;
  if (was && !isActive()) onLeave.forEach(left => left());
}).catch(() => {});
void invoke<string>("active_window")
  .then(answer => {
    if (!heard) active = answer;
  })
  .catch(() => {});
/** Whether this page is the active Relay window. A window that is not one (settings) counts as active. */
export const isActive = () => !relayWindow || active === label;
/** Run `left` each time this window stops being the active one. */
export const whenLeft = (left: () => void) => onLeave.add(left);
