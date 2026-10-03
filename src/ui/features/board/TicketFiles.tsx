import { useEffect, useState, type MouseEvent } from "react";
import type { CardView } from "../../../domain/board/types";
import { openPicture, thumbOf } from "../../../application/board/ctx";
import { size } from "./format";

type TicketFile = NonNullable<CardView["files"]>[number];

/** A card's or a comment's files: the pictures' previews first, then every file by name. A picture opens at full size
 *  in Relay's viewer window, any other file in the browser: both need the tracker's own login. */
export function TicketFiles({ provider, files }: { provider: string; files: TicketFile[] }) {
  const pictures = files.filter(file => file.thumb);
  return (
    <div className="flex flex-col gap-2 my-1.5">
      {!!pictures.length && (
        <div className="flex flex-wrap gap-2">
          {pictures.map(file => (
            <Preview key={file.id} provider={provider} file={file} />
          ))}
        </div>
      )}
      <ul className="flex flex-col gap-1 text-sm">
        {files.map(file => (
          <li key={file.id} className="flex items-baseline gap-2 min-w-0">
            {file.url ? (
              <a className="truncate" href={file.url} onClick={file.thumb ? viewer(provider, file) : undefined}>
                {file.name}
              </a>
            ) : (
              <span className="truncate">{file.name}</span>
            )}
            {file.size > 0 && <span className="text-xs text-secondary tabular-nums">{size(file.size)}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One picture's preview, shown once the backend fetched it. One that fails leaves only its name in the list. */
function Preview({ provider, file }: { provider: string; file: TicketFile }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let live = true;
    thumbOf(provider, file.thumb!).then(
      data => live && setSrc(data),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [provider, file.thumb]);
  if (!src) return null;
  const img = (
    <img className="block size-24 object-cover rounded-lg border border-separator" src={src} alt={file.name} />
  );
  return file.url ? (
    <a href={file.url} title={file.name} onClick={viewer(provider, file)}>
      {img}
    </a>
  ) : (
    img
  );
}

/** A click that opens the picture in the viewer window instead of following the link to the browser. */
const viewer = (provider: string, file: TicketFile) => (e: MouseEvent) => {
  e.preventDefault();
  openPicture(provider, file.url, file.name);
};
