import { LitElement, unsafeCSS, type CSSResultGroup, type ReactiveController, type ReactiveControllerHost } from "lit";
import sharedCss from "../styles/shared.css?inline";

// The app's state lives in plain objects (src/app/state.ts) and is changed in place. `changed()` after a change redraws
// every connected component, once per microtask however often it is called: Lit then patches only what differs.
const listeners = new Set<() => void>();
let queued = false;
export function changed() {
  if (queued) return;
  queued = true;
  queueMicrotask(() => { queued = false; listeners.forEach(f => f()); });
}

/** Redraws its host whenever the store changed. */
export class StoreController implements ReactiveController {
  private f = () => this.host.requestUpdate();
  constructor(private host: ReactiveControllerHost) { host.addController(this); }
  hostConnected() { listeners.add(this.f); }
  hostDisconnected() { listeners.delete(this.f); }
}

/** The rules every component shares (buttons, fields, lists, markdown), on top of the design tokens in base.css. */
export const shared = unsafeCSS(sharedCss);
export const styles = (own: string): CSSResultGroup => [shared, unsafeCSS(own)];

/** A component that follows the store. */
export class RelayElement extends LitElement {
  protected store = new StoreController(this);
}

/** Requests from the logic to the views that only the DOM can do: focus the composer, scroll the conversation. */
export type UiRequest = "focus-composer" | "scroll-bottom" | "scroll-top";
export const ui = new EventTarget();
export const request = (r: UiRequest) => ui.dispatchEvent(new Event(r));

/** localStorage as JSON, quiet when storage is unavailable. */
export const ls = {
  get: <T>(k: string, d: T): T => { try { return JSON.parse(localStorage.getItem(k) || "") ?? d; } catch { return d; } },
  set: (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

/** The element a key or pointer event really started on, inside shadow roots too. */
export const origin = (e: Event) => (e.composedPath()[0] ?? e.target) as HTMLElement;
/** Whether an event started in a text field, wherever it sits. */
export const inField = (e: Event, sel = "input, textarea, select, [contenteditable]") =>
  e.composedPath().some(n => n instanceof HTMLElement && n.matches(sel));
