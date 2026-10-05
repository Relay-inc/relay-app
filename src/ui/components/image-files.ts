import type { ClipboardEvent as ReactClipboardEvent } from "react";
import { pastedPaths } from "../../application/conversations/attachments";

const imageFiles = (clipboard: DataTransfer) =>
  [...clipboard.items]
    .filter(item => item.kind === "file" && item.type.startsWith("image/"))
    .map(item => item.getAsFile())
    .filter((file): file is File => !!file);

// an image on the clipboard becomes a thumbnail. Copied text that also carries an image rendering
// (Numbers, Word) pastes as text the way it always did, only a bare file name (a Finder copy) gives way.
export function pastedImages(e: ClipboardEvent | ReactClipboardEvent): File[] {
  const clipboard = e.clipboardData;
  const text = clipboard?.getData("text/plain").trim() || "";
  const onlyAFileName = /^[^\n/]+\.(png|jpe?g|gif|webp|heic|tiff?)$/i.test(text);
  if (!clipboard || (text && !onlyAFileName)) return [];
  const files = imageFiles(clipboard);
  if (files.length) e.preventDefault();
  return files;
}

// a Finder copy (Cmd-C on files) holds their names as text next to the files themselves
const finderNames = (text: string) =>
  !!text && text.split(/[\r\n]+/).every(line => /^[^/\t]+\.[A-Za-z0-9]{1,8}$/.test(line.trim()));
/** A paste in a composer: files copied in Finder go by their path (`paths`), pictures pasted on their own as images.
 *  A Finder-like paste without paths behind it (a cell from Numbers named like a file) pastes as it would have. */
export function onPasteFiles(
  e: ReactClipboardEvent<HTMLTextAreaElement>,
  images: (files: File[]) => void,
  paths: (paths: string[]) => void,
) {
  const clipboard = e.clipboardData;
  const raw = clipboard.getData("text/plain");
  const text = raw.trim();
  if (!clipboard.types.includes("Files") || !finderNames(text)) {
    const files = pastedImages(e);
    if (files.length) images(files);
    return;
  }
  // the clipboard is only readable during the event: take what the fallback needs before asking for the paths
  e.preventDefault();
  const pictures = imageFiles(clipboard);
  pastedPaths().then(found => {
    if (found.length) paths(found);
    else if (pictures.length) images(pictures);
    else document.execCommand("insertText", false, raw);
  });
}
