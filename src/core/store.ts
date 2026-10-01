import type { ReactiveController, ReactiveControllerHost } from "lit";

// The app's state lives in plain objects, one slice per domain (src/domain/), changed in place. `changed()` after a
// change redraws every connected component once per microtask, however often it is called; Lit then patches only what
// differs. Only containers connect (a StoreController); the components under them get properties.
const listeners = new Set<() => void>();
let queued = false;
export function changed() {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    listeners.forEach(listener => listener());
  });
}

/** Redraws its host whenever the store changed: `private store = new StoreController(this);` in a container. */
export class StoreController implements ReactiveController {
  private redraw = () => this.host.requestUpdate();
  constructor(private host: ReactiveControllerHost) {
    host.addController(this);
  }
  hostConnected() {
    listeners.add(this.redraw);
  }
  hostDisconnected() {
    listeners.delete(this.redraw);
  }
}

/** Requests from the logic to the views that only the DOM can do: focus the composer, scroll the conversation. */
export type UiRequest = "focus-composer" | "scroll-bottom" | "scroll-top";
export const ui = new EventTarget();
export const request = (what: UiRequest) => ui.dispatchEvent(new Event(what));

/** localStorage as JSON, quiet when storage is unavailable. */
export const ls = {
  get: <T>(key: string, fallback: T): T => {
    try {
      return JSON.parse(localStorage.getItem(key) || "") ?? fallback;
    } catch {
      return fallback;
    }
  },
  set: (key: string, value: unknown) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable */
    }
  },
};
