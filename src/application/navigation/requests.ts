/** Requests from the logic to the views that only the DOM can do: focus the composer, scroll the conversation.
 *  The UI listens with `useUiRequest` (ui/hooks). */
export type UiRequest = "focus-composer" | "scroll-bottom" | "scroll-top";
export const uiRequests = new EventTarget();
export const request = (what: UiRequest) => uiRequests.dispatchEvent(new Event(what));
