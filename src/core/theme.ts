import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Accent, Theme } from "../domain/config";

/** The colour scheme for this window: the native window follows it (the sidebar material, the title bar), and so does
 * the css through data-theme on the page. System leaves both to macOS. The accent is data-accent on the page. */
export function applyTheme(theme: Theme = "system", accent: Accent = "relay") {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.accent = accent;
  getCurrentWindow()
    .setTheme(theme === "system" ? null : theme)
    .catch(() => {});
}
