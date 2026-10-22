import { useEffect } from "react";
import { useSettingsStore } from "../../application/settings/store";
import { close, initSettingsWindow, openLink } from "../../application/settings/window";
import { SettingsApp } from "../features/settings/SettingsApp";

// the settings window's keys: Escape and Cmd-W close it
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape" || (e.metaKey && e.key === "w")) close();
}
// a web link (Google's app password page) opens in the browser, the settings window never navigates
function onLink(e: MouseEvent) {
  const link = e
    .composedPath()
    .find((node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement && node.href.startsWith("https:"));
  if (!link) return;
  e.preventDefault();
  openLink(link.href);
}

/** The settings window: its keys and links, registered once; the pages once the settings are read. */
export function SettingsShell() {
  const loaded = useSettingsStore(s => s.loaded);
  useEffect(() => {
    initSettingsWindow();
    window.addEventListener("keydown", onKey);
    document.addEventListener("click", onLink);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onLink);
    };
  }, []);
  return loaded ? <SettingsApp /> : null;
}
