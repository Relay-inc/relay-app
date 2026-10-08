import { invoke } from "@tauri-apps/api/core";
import type { PhoneConversation, PhoneServer } from "../domain/mobile/types";

// The phone's own commands (mobile/src-tauri). The conversation commands have the desktop's names and shapes and
// are called through backend.ts; these are what only the phone has.

/** The paired machine; rejects with "not paired yet" before pairing. Opens the laptop's vault there when it is locked. */
export const phoneInfo = () => invoke<PhoneServer>("info");
/** Pair with the line the laptop made (Settings › Machines › Add phone). */
export const phonePair = (line: string, name: string) => invoke<{ info: PhoneServer }>("pair", { line, name });
/** The laptop's conversations running on the machine. */
export const phoneConversations = () => invoke<PhoneConversation[]>("conversations");
/** Follow a conversation without writing to it: what it says from now on comes as `agent` events. */
export const phoneOpen = (project: string) => invoke("open", { project });
