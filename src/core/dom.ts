import { iconPaths } from "./icons";
/** The element a key or pointer event really started on, inside shadow roots too. */
export const origin = (e: Event) => (e.composedPath()[0] ?? e.target) as HTMLElement;
/** Whether an event started in a text field, wherever it sits. */
export const inField = (e: Event, sel = "input, textarea, select, [contenteditable]") =>
  e.composedPath().some(node => node instanceof HTMLElement && node.matches(sel));
/** A component's own event, bubbling out of its shadow root: `emit(this, "answer", { id })`. Declare it in HTMLElementEventMap. */
export const emit = <T>(el: EventTarget, name: string, detail?: T) =>
  el.dispatchEvent(new CustomEvent<T>(name, { detail, bubbles: true, composed: true }));

/** Text to the clipboard; a button that asked shows a tick for a moment. */
export function copyText(text: string, button?: HTMLElement) {
  navigator.clipboard.writeText(text).catch(e => console.error(e));
  const svg = button?.querySelector("svg");
  if (!svg) return;
  const before = svg.innerHTML;
  svg.innerHTML = iconPaths("check");
  setTimeout(() => (svg.innerHTML = before), 1200);
}
