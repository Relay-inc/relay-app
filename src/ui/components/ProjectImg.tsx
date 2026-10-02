import { isImg } from "../../shared/icons";

/** A project's image in a row, the size of a glyph; nothing unless `url` is an image data url. */
export function ProjectImg({
  url,
  className = "w-[15px] h-[15px] flex-none object-contain rounded-[3px] align-[-2px] mr-1.5",
}: {
  url?: string | null;
  className?: string;
}) {
  return isImg(url) ? <img className={className} src={url} alt="" /> : null;
}
