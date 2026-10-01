import type { ReactiveController, ReactiveControllerHost } from "lit";

// The app's state lives in plain objects, one slice per domain (src/domain/), changed in place. `changed()` after a
// change redraws every connected component once per microtask, however often it is called; Lit then patches only what
// differs. Only containers connect (a StoreController); the components under them get properties.
const listeners = new Set<() => void>();
let queued = false;
export function changed() {
  if (queued) return;
  queued = true;
  queueMicrotask(() => { queued = false; listeners.forEach(f => f()); });
}

/** Redraws its host whenever the store changed: `private store = new StoreController(this);` in a container. */
export class StoreController implements ReactiveController {
  private f = () => this.host.requestUpdate();
  constructor(private host: ReactiveControllerHost) { host.addController(this); }
  hostConnected() { listeners.add(this.f); }
  hostDisconnected() { listeners.delete(this.f); }
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
