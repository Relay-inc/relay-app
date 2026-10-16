// Image files through the browser: read, decode, redraw on a canvas, and blob URLs to show them.

/** A file as a data url. */
export const readUrl = (file: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
async function decoded(file: Blob) {
  const source = await readUrl(file);
  const img = new Image();
  img.src = source;
  try {
    await img.decode();
  } catch {
    return null;
  }
  return { img, source };
}

/** base64 data as a blob url: a short string to show, so redrawing does not carry megabytes of base64. */
export const blobUrl = (mediaType: string, data: string) =>
  URL.createObjectURL(new Blob([Uint8Array.from(atob(data), char => char.charCodeAt(0))], { type: mediaType }));
export const releaseUrl = (url: string) => URL.revokeObjectURL(url);

const MAX_SIDE = 2000;
const MAX_BYTES = 4e6;
// the picture redrawn on a canvas: long side at most 2000 px, png stays png unless it is still too big
function redrawImage(img: HTMLImageElement, file: File, accepted: string[]): string {
  const width = img.naturalWidth;
  const height = img.naturalHeight;
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d")!;
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  context.drawImage(img, 0, 0, canvas.width, canvas.height);
  let redrawn = file.type === "image/png" || !accepted.includes(file.type) ? canvas.toDataURL("image/png") : "";
  if (!redrawn || redrawn.length > (MAX_BYTES * 4) / 3) {
    // jpeg has no transparency: white behind it
    context.globalCompositeOperation = "destination-over";
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    redrawn = canvas.toDataURL("image/jpeg", 0.85);
  }
  return redrawn;
}
/** An image file to send: as it is when small enough and of an `accepted` type, else redrawn (long side 2000 px,
 *  at most 4 MB). Its media type and base64 data; null when it does not decode. */
export async function prepareImage(file: File, accepted: string[]): Promise<{ mt: string; data: string } | null> {
  const read = await decoded(file);
  if (!read) return null;
  const { img, source } = read;
  const tooBig = Math.max(img.naturalWidth, img.naturalHeight) > MAX_SIDE || file.size > MAX_BYTES;
  const dataUrl = !accepted.includes(file.type) || tooBig ? redrawImage(img, file, accepted) : source;
  const parts = dataUrl.match(/^data:(image\/[a-z]+);base64,(.+)$/);
  return parts && accepted.includes(parts[1]) ? { mt: parts[1], data: parts[2] } : null;
}

const ICON_SIZE = 64;
/** An image file (png, jpg, ico, svg, ...) drawn centered on 64 px, as a png data url; null when it does not decode. */
export async function iconFrom(file: Blob): Promise<string | null> {
  const read = await decoded(file);
  if (!read) return null;
  const { img } = read;
  const longest = Math.max(img.naturalWidth, img.naturalHeight) || ICON_SIZE;
  const width = (img.naturalWidth * ICON_SIZE) / longest || ICON_SIZE;
  const height = (img.naturalHeight * ICON_SIZE) / longest || ICON_SIZE;
  const canvas = document.createElement("canvas");
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  canvas.getContext("2d")!.drawImage(img, (ICON_SIZE - width) / 2, (ICON_SIZE - height) / 2, width, height);
  return canvas.toDataURL("image/png");
}
/** A data url (a fetched favicon) as a 64 px icon. Decoded here: the CSP's connect-src blocks fetch() on a data url. */
export function iconFromDataUrl(dataUrl: string) {
  const [, mediaType = "", data = ""] = dataUrl.match(/^data:([^;,]+);base64,(.*)$/) || [];
  return iconFrom(fileOf(mediaType, data, "favicon"));
}
/** base64 data as a File, so a picture read from its path goes through `prepareImage` like a pasted one. */
export const fileOf = (mediaType: string, data: string, name: string) =>
  new File([Uint8Array.from(atob(data), char => char.charCodeAt(0))], name, { type: mediaType });
