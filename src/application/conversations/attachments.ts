import { t } from "../../shared/i18n";
import type { Img } from "../../domain/conversations/types";
import { fileName } from "../../domain/conversations/files";
import * as backend from "../../infrastructure/backend";
import { fileOf } from "../../infrastructure/images";
import { toast } from "../navigation/navigation";
import { prepImages } from "./images";

// Files attached by their path: dropped from Finder, picked with +, or pasted after a Finder copy. Nothing is copied:
// a picture goes inline (read from its path, like a pasted one), every other file or folder goes as its path.

const PICTURE = /\.(png|jpe?g|gif|webp)$/i;
/** Paths as what waits in a composer: the pictures as images, the rest as paths. A picture that cannot be read inline
 *  (too big, broken) goes as its path too: the agent can still read it. */
export async function fromPaths(paths: string[]): Promise<{ images: Img[]; files: string[] }> {
  const read = await Promise.all(
    paths.map(async (path): Promise<Img | string> => {
      if (!PICTURE.test(path)) return path;
      try {
        const [mediaType, data] = await backend.readImage(path);
        const [image] = await prepImages([fileOf(mediaType, data, fileName(path))]);
        return image ?? path;
      } catch {
        return path;
      }
    }),
  );
  return {
    images: read.filter((x): x is Img => typeof x !== "string"),
    files: read.filter((x): x is string => typeof x === "string"),
  };
}

// ---------- where a drop goes: the field drawn last (Cmd-K over the composer), wherever in the window it lands
type DropTarget = { over: (on: boolean) => void; drop: (paths: string[]) => void };
const targets: DropTarget[] = [];
/** A field that takes dropped files while it is mounted. Returns the unregister. */
export function dropTarget(target: DropTarget) {
  targets.push(target);
  return () => {
    const at = targets.indexOf(target);
    if (at >= 0) targets.splice(at, 1);
  };
}
/** Started once at boot: Finder drops on the window go to the top drop target. */
export const listenToFileDrops = () =>
  backend.onFileDrop(({ over, paths }) => {
    const top = targets[targets.length - 1];
    if (!top) return;
    top.over(over);
    if (paths?.length) top.drop(paths);
  });

/** The files copied in Finder as paths, [] when the clipboard holds none. */
export const pastedPaths = () => backend.pastedFiles().catch(() => [] as string[]);
/** The files picked with +, as paths. */
export const pickedPaths = () => backend.pickFiles().catch(() => [] as string[]);
/** An attached file opened from where it is, or shown in Finder. A file that moved or is gone says so. */
export async function openAttached(path: string, reveal: boolean) {
  try {
    await backend.openFile(path, reveal);
  } catch {
    toast(t("file.missing", { name: fileName(path) }));
  }
}
