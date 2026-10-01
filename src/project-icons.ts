// Project icons live in the vault's .relay/config.json (src-tauri/src/relay_config.rs, `icons`): an image file in
// .relay/icons/, an emoji, a website whose favicon the app fetches, or "" for none. Shared by both windows.
import { invoke } from "@tauri-apps/api/core";

/** One project's icon: the raw value from the config, and what to show (`img` a data url, or `icon` an emoji). */
export type ProjectIcon = { value: string; img?: string | null; icon?: string };
export type IconKind = "img" | "emoji" | "site" | "none" | "reset";

export const loadIcons = () => invoke<Record<string, ProjectIcon>>("project_icons").catch(() => ({}) as Record<string, ProjectIcon>);
/** "reset" removes the entry, so the favicon run guesses again; "none" keeps the project without an icon. */
export const setIcon = (project: string, kind: IconKind, value = "") => invoke("set_project_icon", { project, kind, value });
/** A website value: the favicon run fetches it and replaces it with the file. */
export const isSite = (v: string) => v.includes(".") && !/\s/.test(v) && !v.startsWith("icons/");

const readUrl = (f: Blob) => new Promise<string>((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => no(r.error); r.readAsDataURL(f); });
/** An image file (png, jpg, ico, svg, ...) drawn centered on 64 px, as a png data url. */
export async function iconFrom(f: Blob): Promise<string | null> {
  const img = new Image(); img.src = await readUrl(f);
  try { await img.decode(); } catch { return null; }
  const n = Math.max(img.naturalWidth, img.naturalHeight) || 64, w = img.naturalWidth * 64 / n || 64, h = img.naturalHeight * 64 / n || 64;
  const cv = document.createElement("canvas"); cv.width = cv.height = 64;
  cv.getContext("2d")!.drawImage(img, (64 - w) / 2, (64 - h) / 2, w, h);
  return cv.toDataURL("image/png");
}
/** Only an image data url becomes an <img>. */
export const iconImg = (u?: string | null, cls = "pimg") =>
  u && /^data:image\/(png|jpeg|gif|webp|svg\+xml|x-icon);base64,[A-Za-z0-9+/=]+$/.test(u) ? `<img class="${cls}" src="${u}" alt="">` : "";
