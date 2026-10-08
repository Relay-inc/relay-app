import type { PhoneConversation, PhoneServer } from "../../domain/mobile/types";
import { isLang, setLanguage } from "../../shared/i18n";
import * as backend from "../../infrastructure/backend";
import {
  cancelScan,
  phoneConversations,
  phoneInfo,
  phoneOpen,
  phonePair,
  scanCode,
  takeBack,
} from "../../infrastructure/mobile";
import { sendOrStop, setTyped } from "../conversations/actions";
import { onAgentEvent } from "../conversations/events";
import { ensureHistory } from "../conversations/history";
import { pollPending } from "../conversations/polls";
import { show } from "../navigation/navigation";
import { useNavigationStore } from "../navigation/store";
import { makeStore } from "../make-store";
import { t } from "../../shared/i18n";

// an error as text: what invoke and the plugins reject with is a string, an Error or a plain object
const text = (error: unknown) =>
  error instanceof Error ? error.message : typeof error === "string" ? error : JSON.stringify(error);

// The phone (mobile.html): pairing, the laptop's conversations on the machine, opening one. A conversation itself
// runs on the desktop's stores and use cases (application/conversations), against the phone's backend.
// named: the first message of a conversation started here, its title until the machine names it
type PhoneState = {
  paired: boolean | null;
  server: PhoneServer | null;
  list: PhoneConversation[];
  named: Record<string, string>;
  error: string;
  busy: boolean;
};
export const usePhoneStore = makeStore<PhoneState>(() => ({
  paired: null,
  server: null,
  list: [],
  named: {},
  error: "",
  busy: false,
}));
const set = usePhoneStore.setState;

// Android's back button: it cancels a scan and leaves a conversation; on the list it is the system's (closes the app)
let scanning = false;
let giveBack: Promise<() => Promise<void>> | null = null;
function back() {
  if (scanning) cancelScan().catch(() => {});
  else if (useNavigationStore.getState().selected) closeConversation();
}
function backIsOurs(ours: boolean) {
  if (ours && !giveBack) giveBack = takeBack(back).catch(() => async () => {});
  else if (!ours && giveBack) {
    giveBack.then(release => release()).catch(() => {});
    giveBack = null;
  }
}
const backFollows = () => backIsOurs(scanning || !!useNavigationStore.getState().selected);

/** Start: the language of the phone, the conversations' events, the cards, and what the machine has. */
export async function bootPhone() {
  const [lang] = navigator.language.split("-");
  setLanguage(isLang(lang) ? lang : "en", navigator.language);
  // the list first: the selection the desktop keeps (its start view) means nothing here
  show("");
  backend.onAgent((key, event, provider) => onAgentEvent(key, event, provider));
  useNavigationStore.subscribe(backFollows);
  setInterval(() => pollPending().catch(() => {}), 1000);
  // the list keeps itself current while it shows
  setInterval(() => {
    if (usePhoneStore.getState().paired && !useNavigationStore.getState().selected) refresh();
  }, 5000);
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
    const why = text(error);
    set(draft => {
      draft.paired = why.includes("not paired") ? false : draft.paired;
      draft.error = why.includes("not paired") ? "" : why;
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
      draft.error = text(error);
    });
    return false;
  }
}

/** Pair with the code the laptop shows, read with the camera. True when it worked; cancelling the camera is no error. */
export async function scanToPair() {
  scanning = true;
  backFollows();
  const line = await scanCode().catch((error: unknown) => {
    const why = text(error);
    if (!/cancel/i.test(why))
      set(draft => {
        draft.error = why === "camera" ? t("phone.cameraRefused") : why;
      });
    return null;
  });
  scanning = false;
  backFollows();
  return line === null ? false : pair(line);
}

/** Open a conversation: what it said so far, then live. One without an agent yet starts with the first message. */
export async function openConversation(key: string, running: boolean) {
  show(key);
  try {
    await ensureHistory(key);
    if (running) await phoneOpen(key);
  } catch (error) {
    set(draft => {
      draft.error = text(error);
    });
  }
}

/** Start a conversation with its first message, keyed the way the desktop keys a new one (c:<time>). */
export async function startConversation(text: string) {
  const key = `c:${Date.now().toString(36)}`;
  set(draft => {
    draft.named[key] = text.split(/\s+/).join(" ").slice(0, 80);
  });
  await openConversation(key, false);
  setTyped(text);
  await sendOrStop();
}

/** A conversation's title on the phone: the machine's, the one started here, else its key. */
export const titleOf = (key: string) => {
  const { list, named } = usePhoneStore.getState();
  return list.find(c => c.key === key)?.title || named[key] || key;
};

/** Back to the list. */
export function closeConversation() {
  show("");
  refresh();
}
