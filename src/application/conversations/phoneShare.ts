import * as backend from "../../infrastructure/backend";
import type { SlashCommand } from "../../domain/conversations/commands";
import { t } from "../../shared/i18n";
import { makeStore } from "../make-store";

// A conversation on this Mac shared with the phone (`/share-phone`, `/unshare-phone` in the composer): Relay's own
// commands, never sent to the agent. The backend (share.rs) offers the shared ones to the phone through the machine
// it is paired on; `keys` is for the composer's mark.
export const usePhoneShareStore = makeStore<{ keys: string[] }>(() => ({ keys: [] }));

export const loadPhoneShared = () =>
  backend
    .phoneShared()
    .then(keys =>
      usePhoneShareStore.setState(draft => {
        draft.keys = keys;
      }),
    )
    .catch(error => console.error(error));

/** Whether the conversation is shared with the phone. */
export const isPhoneShared = (key: string) => usePhoneShareStore.getState().keys.includes(key);

/** Relay's own commands, next to the agent's in the composer's completion. */
export const phoneCommands = (): SlashCommand[] => [
  { name: "share-phone", description: t("phone.shareCmd") },
  { name: "unshare-phone", description: t("phone.unshareCmd") },
];

/** `/share-phone` or `/unshare-phone` alone: on (true) or off (false); null for any other text. */
export function phoneCommand(text: string): boolean | null {
  const name = /^\/(share-phone|unshare-phone)$/.exec(text.trim())?.[1];
  return name ? name === "share-phone" : null;
}

/** Share a conversation with the phone or stop: the note to show in it, the backend's refusal included. */
export async function setPhoneShare(key: string, on: boolean, title: string, mail: boolean): Promise<string> {
  try {
    await backend.phoneShare(key, on, title, mail);
    await loadPhoneShared();
    return t(on ? "note.phoneShared" : "note.phoneUnshared");
  } catch (error) {
    return String(error);
  }
}
