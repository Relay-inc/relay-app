import type { Img } from "../../domain/conversations/types";
import { IMG_OK } from "../../domain/conversations/events";
import { blobUrl, prepareImage, releaseUrl } from "../../infrastructure/images";

// Images shown through blob URLs: short strings, so redrawing the log does not re-parse megabytes of base64.
const toImg = (mediaType: string, data: string): Img => ({ mt: mediaType, data, url: blobUrl(mediaType, data) });
export const imageUrl = blobUrl;

/** Pasted or dropped files as images ready to send; what is not a readable image is left out. */
export const prepImages = async (files: File[]) =>
  (
    await Promise.all(
      files
        .filter(file => file.type.startsWith("image/"))
        .map(file =>
          prepareImage(file, IMG_OK)
            .then(image => image && toImg(image.mt, image.data))
            .catch(() => null),
        ),
    )
  ).filter((image): image is Img => !!image);
/** Images that will not be sent: their blob urls freed. */
export const releaseImages = (images: Img[]) => images.forEach(image => releaseUrl(image.url));
