import { useEffect, useState } from "react";
import type { CardView } from "../../../domain/board/types";
import { thumbOf } from "../../../application/board/ctx";
import { size } from "./format";

type TicketFile = NonNullable<CardView["files"]>[number];

/** A card's or a comment's files: the pictures' previews first, then every file by name. Opening one needs the
 *  tracker's session, so a click goes to the browser. */
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
              <a className="truncate" href={file.url}>
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
    <a href={file.url} title={file.name}>
      {img}
    </a>
  ) : (
    img
  );
}
