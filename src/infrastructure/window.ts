import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Accent, Theme } from "../domain/settings/types";

// The window around the page: its colour scheme, title, focus, and the page's language.

/** The colour scheme for this window: the native window follows it (the sidebar material, the title bar), and so does
 * the css through data-theme on the page. System leaves both to macOS. The accent is data-accent on the page.
 * A change after the first one goes through a view transition, so everything shows in one frame. The new frame waits
 * for macOS's appearance to reach the page: WebKit draws text differently in light and dark and repaints it only then.
 * Meanwhile the old frame covers the sidebar (data-theme-switch), so the native material flips out of sight. Resolves
 * when the switch is over: save after it, a save blocks the main thread the window draws on. */
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
  root.dataset.themeSwitch = "";
  const transition = document.startViewTransition(async () => {
    try {
      apply();
      const flipped = theme !== "system" && prefersDark() !== (theme === "dark") ? schemeChange() : undefined;
      await native();
      await flipped;
    } finally {
      delete root.dataset.themeSwitch;
    }
  });
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
