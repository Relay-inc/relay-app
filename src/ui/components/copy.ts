import { iconPaths } from "../../shared/icons";
import { copy } from "../../application/navigation/navigation";

/** Text to the clipboard; a button that asked shows a tick in its icon for a moment. The tick rewrites the button's
 *  svg, so `button` must be markup React does not render (markdown's copy button); a React button keeps its own state. */
export function copyText(text: string, button?: HTMLElement | null) {
  void copy(text);
  const svg = button?.querySelector("svg");
  if (!svg) return;
  const before = svg.innerHTML;
  svg.innerHTML = iconPaths("check");
  setTimeout(() => (svg.innerHTML = before), 1200);
}
