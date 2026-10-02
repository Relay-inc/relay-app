import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Theme } from "../domain/settings/types";

// The window around the page: its colour scheme, title, focus, and the page's language.

/** The colour scheme for this window: the native window follows it (the sidebar material, the title bar), and so does
 * the css through data-theme on the page. System leaves both to macOS. */
export function applyTheme(theme: Theme = "system") {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  getCurrentWindow()
    .setTheme(theme === "system" ? null : theme)
    .catch(() => {});
}
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
