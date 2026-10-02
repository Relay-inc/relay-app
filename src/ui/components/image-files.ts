import type { ClipboardEvent as ReactClipboardEvent, DragEvent as ReactDragEvent } from "react";

// an image on the clipboard becomes a thumbnail. Copied text that also carries an image rendering
// (Numbers, Word) pastes as text the way it always did, only a bare file name (a Finder copy) gives way.
export function pastedImages(e: ClipboardEvent | ReactClipboardEvent): File[] {
  const clipboard = e.clipboardData;
  const text = clipboard?.getData("text/plain").trim() || "";
  const onlyAFileName = /^[^\n/]+\.(png|jpe?g|gif|webp|heic|tiff?)$/i.test(text);
  if (!clipboard || (text && !onlyAFileName)) return [];
  const files = [...clipboard.items]
    .filter(item => item.kind === "file" && item.type.startsWith("image/"))
    .map(item => item.getAsFile())
    .filter((file): file is File => !!file);
  if (files.length) e.preventDefault();
  return files;
}
export const hasFiles = (e: DragEvent | ReactDragEvent) => !!e.dataTransfer?.types.includes("Files");
