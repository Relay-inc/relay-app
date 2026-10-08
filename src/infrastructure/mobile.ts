import { invoke } from "@tauri-apps/api/core";
import { onBackButtonPress } from "@tauri-apps/api/app";
import { cancel, checkPermissions, Format, requestPermissions, scan } from "@tauri-apps/plugin-barcode-scanner";
import type { PhoneConversation, PhoneServer } from "../domain/mobile/types";

// The phone's own commands (mobile/src-tauri). The conversation commands have the desktop's names and shapes and
// are called through backend.ts; these are what only the phone has.

/** The paired machine; rejects with "not paired yet" before pairing. Opens the laptop's vault there when it is locked. */
export const phoneInfo = () => invoke<PhoneServer>("info");
/** Pair with the line the laptop made (Settings › Machines › Add phone). */
export const phonePair = (line: string, name: string) => invoke<{ info: PhoneServer }>("pair", { line, name });
/** The laptop's conversations running on the machine. */
export const phoneConversations = () => invoke<PhoneConversation[]>("conversations");
/** Scan a QR code with the camera: its text (the pairing line the laptop shows). Rejects when cancelled or refused. */
export async function scanCode() {
  // the camera is asked for the first time it is needed; refused, it is "camera" (the page says what to do)
  if ((await checkPermissions()) !== "granted" && (await requestPermissions()) !== "granted") throw new Error("camera");
  return (await scan({ formats: [Format.QRCode], windowed: false })).content;
}
/** Close the camera of a scan that runs (its scan rejects as cancelled). */
export const cancelScan = () => cancel();
/** Android's back button: while a handler is registered it replaces the default (closing the app). Resolves with the
 *  function that gives the default back. */
export const takeBack = (handler: () => void) => onBackButtonPress(() => handler()).then(l => () => l.unregister());
/** Follow a conversation without writing to it: what it says from now on comes as `agent` events. */
export const phoneOpen = (project: string) => invoke("open", { project });
