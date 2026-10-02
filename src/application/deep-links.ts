import { parseLink, unhandled } from "../domain/navigation/deep-links";
import * as backend from "../infrastructure/backend";
import { session } from "../infrastructure/storage";
import { openProject, quickProjects, toggleQuickAsk } from "./navigation/navigation";

/** A relay:// link from outside the app (Raycast, a launcher, any web page). Deliberately unlike Lit, which sent
 *  `ask?q=` at once: an ask link only opens Cmd-K with its question typed, and nothing goes to an agent until the user
 *  presses Enter there (where a matching project can be picked as always). */
function handleLink(link: string) {
  const parsed = parseLink(link);
  if (parsed?.kind === "ask") toggleQuickAsk(true, parsed.text);
  else if (parsed?.kind === "open") {
    const [best] = quickProjects(parsed.query);
    if (best) openProject(best.name);
    else toggleQuickAsk(true);
  }
}

// a webview reload boots again and the launch links come back: the ones handled in this app launch are remembered
const HANDLED = "handledLinks";
function handleOnce(link: string) {
  session.set(HANDLED, [...session.get<string[]>(HANDLED, []), link]);
  handleLink(link);
}
/** The link that launched the app, once per launch, then every one opened later. */
export async function listenToLinks() {
  unhandled(await backend.launchLinks(), session.get<string[]>(HANDLED, [])).forEach(handleOnce);
  backend.onDeepLink(handleOnce);
}
