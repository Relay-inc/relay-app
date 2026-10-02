import type { CardView } from "../../../domain/board/types";
import { size } from "./format";

/** A card's or a comment's files. Opening one needs the tracker's session, so a link to the browser. */
export function TicketFiles({ files }: { files: NonNullable<CardView["files"]> }) {
  return (
    <ul className="flex flex-col gap-1 my-1.5 text-sm">
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
  );
}
