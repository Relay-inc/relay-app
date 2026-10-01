// an image on the clipboard becomes a thumbnail. Copied text that also carries an image rendering
// (Numbers, Word) pastes as text the way it always did, only a bare file name (a Finder copy) gives way.
export function pastedImages(e: ClipboardEvent): File[] {
  const cd = e.clipboardData, text = cd?.getData("text/plain").trim() || "";
  if (!cd || (text && !/^[^\n/]+\.(png|jpe?g|gif|webp|heic|tiff?)$/i.test(text))) return [];
  const files = [...cd.items].filter(i => i.kind === "file" && i.type.startsWith("image/")).map(i => i.getAsFile()).filter((f): f is File => !!f);
  if (files.length) e.preventDefault();
  return files;
}
export const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");
