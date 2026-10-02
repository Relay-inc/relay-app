import type { IconKind } from "../../domain/workspace/types";
import * as backend from "../../infrastructure/backend";

// Project icons: "reset" removes the entry, so the favicon run guesses again; "none" keeps the project without an icon.
export const loadIcons = () =>
  backend.projectIcons().catch(() => ({}) as Awaited<ReturnType<typeof backend.projectIcons>>);
export const setIcon = (project: string, kind: IconKind, value = "") => backend.setProjectIcon(project, kind, value);

/** An image file drawn as a 64 px project icon (a png data url), null when it is not an image. The drawing itself is
 *  the browser's (infrastructure/images.ts). */
export { iconFrom } from "../../infrastructure/images";
