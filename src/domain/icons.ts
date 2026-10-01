// Project icons live in the vault's .relay/config.json (src-tauri/src/relay_config.rs, `icons`): an image file in
// .relay/icons/, an emoji, a website whose favicon the app fetches, or "" for none. Shared by both windows.
import { invoke } from "@tauri-apps/api/core";

/** One project's icon: the raw value from the config, and what to show (`img` a data url, or `icon` an emoji). */
export type ProjectIcon = { value: string; img?: string | null; icon?: string };
export type IconKind = "img" | "emoji" | "site" | "none" | "reset";

export const loadIcons = () =>
  invoke<Record<string, ProjectIcon>>("project_icons").catch(() => ({}) as Record<string, ProjectIcon>);
/** "reset" removes the entry, so the favicon run guesses again; "none" keeps the project without an icon. */
export const setIcon = (project: string, kind: IconKind, value = "") =>
  invoke("set_project_icon", { project, kind, value });
/** A website value: the favicon run fetches it and replaces it with the file. */
export const isSite = (value: string) => value.includes(".") && !/\s/.test(value) && !value.startsWith("icons/");

const readUrl = (file: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
const ICON_SIZE = 64;
/** An image file (png, jpg, ico, svg, ...) drawn centered on 64 px, as a png data url. */
export async function iconFrom(file: Blob): Promise<string | null> {
  const img = new Image();
  img.src = await readUrl(file);
  try {
    await img.decode();
  } catch {
    return null;
  }
  const longest = Math.max(img.naturalWidth, img.naturalHeight) || ICON_SIZE;
  const width = (img.naturalWidth * ICON_SIZE) / longest || ICON_SIZE;
  const height = (img.naturalHeight * ICON_SIZE) / longest || ICON_SIZE;
  const canvas = document.createElement("canvas");
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  canvas.getContext("2d")!.drawImage(img, (ICON_SIZE - width) / 2, (ICON_SIZE - height) / 2, width, height);
  return canvas.toDataURL("image/png");
}
