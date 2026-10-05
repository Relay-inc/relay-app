import { t } from "../../shared/i18n";
import type { AgentEvent } from "../../domain/agents/types";
import { applyAgentEvent, type Effect } from "../../domain/conversations/events";
import { WAIT } from "../../domain/navigation/views";
import * as backend from "../../infrastructure/backend";
import { isFocused } from "../../infrastructure/window";
import { useNavigationStore } from "../navigation/store";
import { loadSnapshot } from "../workspace/vault";
import { useConversationsStore } from "./store";
import { label } from "./selectors";
import { saveChats } from "./chats";

// The agent processes' events, through the pure reducer (domain/conversations/events.ts). Stream deltas are the hot
// path: the text deltas of one animation frame go into the store as one update, so a delta redraws the streaming
// message once per frame. Any other event first applies what is buffered, then itself, at once: a turn end in a
// window in the background (no frames there) still gives its banner.

/** A banner while the window is in the background, a click opens that conversation (src-tauri/src/notify.rs). */
export async function notify(key: string, body: string) {
  if (await isFocused()) return;
  backend.notify(
    key,
    key === WAIT ? t("nav.today") : label(key),
    body
      .replace(/[#*`>_]+/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160),
  );
}

function run(effects: Effect[]) {
  const once = new Set<string>();
  for (const effect of effects) {
    if (effect.kind === "notify") notify(effect.key, effect.body);
    else if (!once.has(effect.kind)) {
      once.add(effect.kind);
      if (effect.kind === "save-chats") saveChats();
      else if (effect.kind === "snapshot") loadSnapshot();
    }
  }
}

// a conversation key, its event and the provider whose process sent it
type Received = [string, AgentEvent, string];
function apply(events: Received[]) {
  if (!events.length) return;
  const effects: Effect[] = [];
  const env = { t, selected: useNavigationStore.getState().selected, now: Date.now() };
  useConversationsStore.setState(draft => {
    for (const [key, event, provider] of events) effects.push(...applyAgentEvent(draft, key, event, env, provider));
  });
  run(effects);
}

let buffered: Received[] = [];
let frame = 0;
/** Apply the text deltas still waiting for a frame: a use case that writes a conversation first calls this, so the
 *  answer so far lands before what it writes. */
export function flush() {
  cancelAnimationFrame(frame);
  frame = 0;
  const events = buffered;
  buffered = [];
  apply(events);
}
/** The backend's `agent` event for one conversation. */
export function onAgentEvent(key: string, event: AgentEvent, provider = "claude") {
  if (event.type === "text" && event.delta) {
    buffered.push([key, event, provider]);
    frame ||= requestAnimationFrame(flush);
    return;
  }
  flush();
  apply([[key, event, provider]]);
}
