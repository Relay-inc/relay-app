import { VIEW, isTerminal } from "../navigation/keys.ts";
import type { ConversationsState, DraftsState } from "./state";

/** What sending does, decided before anything changes. `take`: what is typed leaves the composer, which it only does
 *  once the text really goes (a turn running outside the app keeps it typed). */
type SendPlan =
  | { kind: "nothing" } // nothing to send, or the waiting view
  | { kind: "fork"; text: string; take: boolean } // a terminal session: forked into an app conversation, then sent
  | { kind: "wait-outside"; key: string } // a turn runs in a process outside the app: a second one would fork the transcript
  | { kind: "send"; key: string; text: string; take: boolean };

/** `forced` text, or what is typed in the open conversation (`selected`) with its images; `to` a conversation that is
 *  not open (Cmd-K) with `toImages` of its own. */
export function planSend(
  state: DraftsState & Pick<ConversationsState, "outside">,
  selected: string,
  forced?: string,
  to?: string,
  toImages = 0,
): SendPlan {
  const fromComposer = forced === undefined;
  const text = forced ?? (state.typed[selected] ?? "").trim();
  const take = fromComposer && !!text;
  if ((!text && !(to ? toImages : state.attached.length)) || (!to && selected === VIEW.wait))
    return { kind: "nothing" };
  if (!to && isTerminal(selected)) return { kind: "fork", text, take };
  const key = to ?? selected;
  if (key in state.outside) return { kind: "wait-outside", key };
  return { kind: "send", key, text, take };
}
