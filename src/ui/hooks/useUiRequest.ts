import { useEffect } from "react";
import { uiRequests, type UiRequest } from "../../application/navigation/requests";

/** Run `handler` when the logic asks the view for something only the DOM can do (focus the composer, scroll the log). */
export function useUiRequest(what: UiRequest, handler: () => void) {
  useEffect(() => {
    uiRequests.addEventListener(what, handler);
    return () => uiRequests.removeEventListener(what, handler);
  }, [what, handler]);
}
