import type { PhoneConversation, PhoneServer } from "../../domain/mobile/types";
import { isLang, setLanguage } from "../../shared/i18n";
import * as backend from "../../infrastructure/backend";
import { phoneConversations, phoneInfo, phoneOpen, phonePair } from "../../infrastructure/mobile";
import { onAgentEvent } from "../conversations/events";
import { ensureHistory } from "../conversations/history";
import { pollPending } from "../conversations/polls";
import { show } from "../navigation/navigation";
import { makeStore } from "../make-store";

// The phone (mobile.html): pairing, the laptop's conversations on the machine, opening one. A conversation itself
// runs on the desktop's stores and use cases (application/conversations), against the phone's backend.
type PhoneState = {
  paired: boolean | null;
  server: PhoneServer | null;
  list: PhoneConversation[];
  error: string;
  busy: boolean;
};
export const usePhoneStore = makeStore<PhoneState>(() => ({
  paired: null,
  server: null,
  list: [],
  error: "",
  busy: false,
}));
const set = usePhoneStore.setState;

/** Start: the language of the phone, the conversations' events, the cards, and what the machine has. */
export async function bootPhone() {
  const [lang] = navigator.language.split("-");
  setLanguage(isLang(lang) ? lang : "en", navigator.language);
  // the list first: the selection the desktop keeps (its start view) means nothing here
  show("");
  backend.onAgent((key, event, provider) => onAgentEvent(key, event, provider));
  setInterval(() => pollPending().catch(() => {}), 1000);
  await refresh();
}

/** Whether it is paired, the machine, and the conversations there. */
export async function refresh() {
  set(draft => {
    draft.busy = true;
  });
  try {
    const server = await phoneInfo();
    const list = await phoneConversations();
    set(draft => {
      Object.assign(draft, { paired: true, server, list, error: "" });
    });
  } catch (error) {
    const text = String(error);
    set(draft => {
      draft.paired = text.includes("not paired") ? false : draft.paired;
      draft.error = text.includes("not paired") ? "" : text;
    });
  } finally {
    set(draft => {
      draft.busy = false;
    });
  }
}

/** Pair with the line from the laptop. True when it worked. */
export async function pair(line: string) {
  try {
    await phonePair(line.trim(), "phone");
    await refresh();
    return true;
  } catch (error) {
    set(draft => {
      draft.error = String(error);
    });
    return false;
  }
}

/** Open a conversation: what it said so far, then live. One without an agent yet starts with the first message. */
export async function openConversation(key: string, running: boolean) {
  show(key);
  try {
    await ensureHistory(key);
    if (running) await phoneOpen(key);
  } catch (error) {
    set(draft => {
      draft.error = String(error);
    });
  }
}

/** Back to the list. */
export function closeConversation() {
  show("");
  refresh();
}
