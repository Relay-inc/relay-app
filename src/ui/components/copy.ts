import { iconPaths } from "../../shared/icons";

/** Text to the clipboard; a button that asked shows a tick in its icon for a moment. The tick rewrites the button's
 *  svg, so `button` must be markup React does not render (markdown's copy button); a React button keeps its own state. */
export function copyText(text: string, button?: HTMLElement | null) {
  navigator.clipboard.writeText(text).catch(e => console.error(e));
  const svg = button?.querySelector("svg");
  if (!svg) return;
  const before = svg.innerHTML;
  svg.innerHTML = iconPaths("check");
  setTimeout(() => (svg.innerHTML = before), 1200);
}
