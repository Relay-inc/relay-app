import type { CardFile } from "../../../domain/board/types";

/** A card's or a comment's files. Opening one needs the tracker's session, so a link to the browser. */
export function CardFiles({ files }: { files: CardFile[] }) {
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
          <span className="text-xs text-secondary tabular-nums">{file.size}</span>
        </li>
      ))}
    </ul>
  );
}
