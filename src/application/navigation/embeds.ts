import { currentLocale, t } from "../../shared/i18n";
import { fileSize } from "../../shared/format";
import { MAX_ATTACHMENT, pastedName } from "../../domain/workspace/embeds";
import * as backend from "../../infrastructure/backend";
import { openAttached, pastedPaths, pickedPaths } from "../conversations/attachments";
import { toast } from "./navigation";

// Files inside a page: what its embeds are (resolved by the backend), and the files added to it by drop, paste or / →
// File, copied into the workspace's attachments folder (src-tauri/src/attach.rs).

export type { EmbedInfo } from "../../infrastructure/backend";
export const embedUrl = backend.fileUrl;

const known = new Map<string, Promise<backend.EmbedInfo>>();
/** What the embed `target` of `page` is: its file and kind, a PDF's pages and first page, a note's text. Asked once per
 *  page opened; `forgetEmbeds` when its editor is made again. */
export function embedOf(page: string, target: string): Promise<backend.EmbedInfo> {
  const key = `${page}\u001f${target}`;
  if (!known.has(key))
    known.set(
      key,
      backend
        .embedInfo(page, [target])
        .then(([info]) => info ?? { target, missing: true })
        .catch(() => ({ target, missing: true })),
    );
  return known.get(key)!;
}
export function forgetEmbeds(page: string) {
  for (const key of [...known.keys()]) if (key.startsWith(`${page}\u001f`)) known.delete(key);
}
/** An attachment in its default app (a PDF in Preview). */
export const openEmbed = (path: string) => openAttached(path, false);

const dests = new Map<string, Promise<string>>();
/** The folder a file added to the page is copied to ("Attachments/2026"), for the drop's label. */
export function attachDest(page: string) {
  if (!dests.has(page))
    dests.set(
      page,
      backend.attachDest(page).catch(() => "Attachments"),
    );
  return dests.get(page)!;
}

/** The names to embed the added files by; a file over the limit is told once and left out. */
function embedNames(done: backend.Attached[]) {
  const big = done.find(d => "tooLarge" in d);
  if (big && "tooLarge" in big)
    toast(
      t("attach.tooLarge"),
      undefined,
      undefined,
      8000,
      big.name ? t("attach.tooLargeDetail", { name: big.name, size: fileSize(big.size, currentLocale()) }) : undefined,
    );
  return done.flatMap(d => ("link" in d ? [d.link] : []));
}
/** Files at paths (dropped, copied in Finder, picked with / → File) copied into the page's attachments folder. */
export async function attachPaths(page: string, paths: string[]): Promise<string[]> {
  try {
    return embedNames(await backend.attachCopy(page, paths));
  } catch (e) {
    toast(String(e));
    return [];
  }
}
/** Files chosen with / → File. */
export const pickAttachments = async (page: string) => {
  const paths = await pickedPaths();
  return paths.length ? attachPaths(page, paths) : [];
};
const base64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
/** What was pasted (a screenshot, a file) saved into the page's attachments folder: pictures as `Pasted image <stamp>`.
 *  `finder`: the paste was a Finder copy, whose files are at paths. A file over the limit is not even read. */
export async function pasteAttachments(page: string, files: File[], finder: boolean): Promise<string[]> {
  if (finder) {
    const paths = await pastedPaths();
    if (paths.length) return attachPaths(page, paths);
  }
  const small = files.filter(f => f.size <= MAX_ATTACHMENT);
  const done: backend.Attached[] =
    files.length > small.length ? [{ tooLarge: true, name: "", size: MAX_ATTACHMENT + 1 }] : [];
  try {
    for (const file of small)
      done.push(await backend.attachSave(page, pastedName(file, new Date()), await base64(file)));
  } catch (e) {
    toast(String(e));
  }
  return embedNames(done);
}
