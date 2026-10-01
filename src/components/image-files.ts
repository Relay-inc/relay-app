// an image on the clipboard becomes a thumbnail. Copied text that also carries an image rendering
// (Numbers, Word) pastes as text the way it always did, only a bare file name (a Finder copy) gives way.
export function pastedImages(e: ClipboardEvent): File[] {
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
export const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");
